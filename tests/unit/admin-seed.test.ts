import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CloudFormationCustomResourceEvent } from 'aws-lambda';

// Use vi.hoisted so mockSend is available inside the hoisted vi.mock factory
const mockSend = vi.hoisted(() => vi.fn());

vi.mock('@aws-sdk/client-cognito-identity-provider', () => {
  class MockCognitoIdentityProviderClient {
    send = mockSend;
  }

  return {
    CognitoIdentityProviderClient: MockCognitoIdentityProviderClient,
    AdminGetUserCommand: class AdminGetUserCommand {
      _type = 'AdminGetUser';
      input: unknown;
      constructor(input: unknown) { this.input = input; }
    },
    AdminCreateUserCommand: class AdminCreateUserCommand {
      _type = 'AdminCreateUser';
      input: unknown;
      constructor(input: unknown) { this.input = input; }
    },
    AdminSetUserPasswordCommand: class AdminSetUserPasswordCommand {
      _type = 'AdminSetUserPassword';
      input: unknown;
      constructor(input: unknown) { this.input = input; }
    },
    AdminAddUserToGroupCommand: class AdminAddUserToGroupCommand {
      _type = 'AdminAddUserToGroup';
      input: unknown;
      constructor(input: unknown) { this.input = input; }
    },
    CreateGroupCommand: class CreateGroupCommand {
      _type = 'CreateGroup';
      input: unknown;
      constructor(input: unknown) { this.input = input; }
    },
    UserNotFoundException: class UserNotFoundException extends Error {
      constructor() {
        super('User not found');
        this.name = 'UserNotFoundException';
      }
    },
    GroupExistsException: class GroupExistsException extends Error {
      constructor() {
        super('Group already exists');
        this.name = 'GroupExistsException';
      }
    },
  };
});

vi.mock('crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('crypto')>();
  return {
    ...actual,
    randomBytes: (size: number) => {
      const buf = Buffer.alloc(size);
      for (let i = 0; i < size; i++) {
        buf[i] = (i * 37 + 13) % 256;
      }
      return buf;
    },
  };
});

// Set environment variables before importing handler
process.env.USER_POOL_ID = 'us-east-1_TestPool';
process.env.ADMIN_EMAIL = 'admin@aileague.community';

import { handler } from '../../lambda/admin-seed/index';
import {
  UserNotFoundException,
  GroupExistsException,
} from '@aws-sdk/client-cognito-identity-provider';

function createEvent(requestType: string): CloudFormationCustomResourceEvent {
  return {
    RequestType: requestType as 'Create' | 'Update' | 'Delete',
    ServiceToken: 'arn:aws:lambda:us-east-1:123456789:function:test',
    ResponseURL: 'https://cloudformation-custom-resource-response.s3.amazonaws.com/test',
    StackId: 'arn:aws:cloudformation:us-east-1:123456789:stack/test/guid',
    RequestId: 'unique-id-1234',
    ResourceType: 'Custom::AdminSeed',
    LogicalResourceId: 'AdminSeed',
    ResourceProperties: {
      ServiceToken: 'arn:aws:lambda:us-east-1:123456789:function:test',
    },
  } as CloudFormationCustomResourceEvent;
}

describe('Admin Seed Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Create event - user does not exist', () => {
    it('creates user with correct password policy when user does not exist', async () => {
      // AdminGetUser throws UserNotFoundException (user doesn't exist)
      mockSend.mockImplementation((command: { _type: string }) => {
        if (command._type === 'AdminGetUser') {
          throw new UserNotFoundException();
        }
        return {};
      });

      const result = await handler(createEvent('Create'));

      expect(result.Status).toBe('SUCCESS');
      expect(result.Data?.AdminPassword).toBeDefined();
      expect(result.Data?.AdminPassword).toHaveLength(16);

      // Verify password meets policy: at least one uppercase, lowercase, digit, special
      const password = result.Data!.AdminPassword as string;
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[0-9]/);
      expect(password).toMatch(/[!@#$%^&*()\-_=+\[\]{}|;:,.<>?]/);

      // Verify the correct sequence of SDK calls
      const callTypes = mockSend.mock.calls.map(
        (call: [{ _type: string }]) => call[0]._type
      );
      expect(callTypes).toContain('AdminGetUser');
      expect(callTypes).toContain('AdminCreateUser');
      expect(callTypes).toContain('AdminSetUserPassword');
      expect(callTypes).toContain('CreateGroup');
      expect(callTypes).toContain('AdminAddUserToGroup');
    });

    it('sets password as permanent', async () => {
      mockSend.mockImplementation((command: { _type: string }) => {
        if (command._type === 'AdminGetUser') {
          throw new UserNotFoundException();
        }
        return {};
      });

      await handler(createEvent('Create'));

      // Find the AdminSetUserPassword call and verify Permanent is true
      const setPasswordCall = mockSend.mock.calls.find(
        (call: [{ _type: string; input?: Record<string, unknown> }]) =>
          call[0]._type === 'AdminSetUserPassword'
      );
      expect(setPasswordCall).toBeDefined();
      expect(setPasswordCall![0].input.Permanent).toBe(true);
    });
  });

  describe('Create event - user already exists', () => {
    it('returns no-op when user already exists (AdminGetUser succeeds)', async () => {
      // AdminGetUser succeeds (user exists)
      mockSend.mockImplementation((command: { _type: string }) => {
        if (command._type === 'AdminGetUser') {
          return { Username: 'admin@aileague.community' };
        }
        return {};
      });

      const result = await handler(createEvent('Create'));

      expect(result.Status).toBe('SUCCESS');
      expect(result.Data?.AdminPassword).toBe('EXISTING_USER_NOT_MODIFIED');
      expect(result.Data?.Message).toContain('already exists');

      // Verify no creation calls were made
      const callTypes = mockSend.mock.calls.map(
        (call: [{ _type: string }]) => call[0]._type
      );
      expect(callTypes).not.toContain('AdminCreateUser');
      expect(callTypes).not.toContain('AdminSetUserPassword');
      expect(callTypes).not.toContain('AdminAddUserToGroup');
      expect(callTypes).not.toContain('CreateGroup');
    });
  });

  describe('Group creation', () => {
    it('creates admin group if it does not exist before adding user', async () => {
      const callOrder: string[] = [];
      mockSend.mockImplementation((command: { _type: string }) => {
        callOrder.push(command._type);
        if (command._type === 'AdminGetUser') {
          throw new UserNotFoundException();
        }
        return {};
      });

      await handler(createEvent('Create'));

      // Verify CreateGroup is called before AdminAddUserToGroup
      const createGroupIndex = callOrder.indexOf('CreateGroup');
      const addToGroupIndex = callOrder.indexOf('AdminAddUserToGroup');
      expect(createGroupIndex).toBeGreaterThan(-1);
      expect(addToGroupIndex).toBeGreaterThan(-1);
      expect(createGroupIndex).toBeLessThan(addToGroupIndex);
    });

    it('handles GroupExistsException gracefully when group already exists', async () => {
      mockSend.mockImplementation((command: { _type: string }) => {
        if (command._type === 'AdminGetUser') {
          throw new UserNotFoundException();
        }
        if (command._type === 'CreateGroup') {
          throw new GroupExistsException();
        }
        return {};
      });

      const result = await handler(createEvent('Create'));

      // Should still succeed even if group already exists
      expect(result.Status).toBe('SUCCESS');
      expect(result.Data?.AdminPassword).toBeDefined();
      expect(result.Data?.AdminPassword).toHaveLength(16);
    });
  });

  describe('Error handling', () => {
    it('handles Cognito API errors gracefully', async () => {
      mockSend.mockImplementation((command: { _type: string }) => {
        if (command._type === 'AdminGetUser') {
          throw new Error('Service unavailable');
        }
        return {};
      });

      const result = await handler(createEvent('Create'));

      expect(result.Status).toBe('FAILED');
      expect(result.Reason).toContain('Service unavailable');
    });

    it('returns FAILED with error reason when AdminCreateUser fails', async () => {
      mockSend.mockImplementation((command: { _type: string }) => {
        if (command._type === 'AdminGetUser') {
          throw new UserNotFoundException();
        }
        if (command._type === 'AdminCreateUser') {
          throw new Error('InvalidParameterException: Password too weak');
        }
        return {};
      });

      const result = await handler(createEvent('Create'));

      expect(result.Status).toBe('FAILED');
      expect(result.Reason).toContain('InvalidParameterException');
    });
  });

  describe('Update and Delete events', () => {
    it('returns success no-op on Update event', async () => {
      const result = await handler(createEvent('Update'));

      expect(result.Status).toBe('SUCCESS');
      expect(result.Data?.AdminPassword).toBe('NO_CHANGE_ON_UPDATE');
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('returns success no-op on Delete event', async () => {
      const result = await handler(createEvent('Delete'));

      expect(result.Status).toBe('SUCCESS');
      expect(result.Data?.AdminPassword).toBe('NO_CHANGE_ON_DELETE');
      expect(mockSend).not.toHaveBeenCalled();
    });
  });
});
