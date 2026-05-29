import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';

/**
 * Property 1: Admin Seed Idempotency
 *
 * For any existing admin user state in the Cognito User Pool, invoking the admin seed
 * custom resource handler SHALL result in no mutations to the user — the handler is a
 * no-op when the user already exists.
 *
 * **Validates: Requirements 2.5**
 */

// Mock the AWS SDK Cognito client
const { mockSend } = vi.hoisted(() => {
  return { mockSend: vi.fn() };
});

vi.mock('@aws-sdk/client-cognito-identity-provider', () => {
  class UserNotFoundException extends Error {
    constructor() {
      super('User does not exist.');
      this.name = 'UserNotFoundException';
    }
  }
  class GroupExistsException extends Error {
    constructor() {
      super('Group already exists.');
      this.name = 'GroupExistsException';
    }
  }
  class CognitoIdentityProviderClient {
    send = mockSend;
  }
  class AdminGetUserCommand {
    _type = 'AdminGetUserCommand';
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class AdminCreateUserCommand {
    _type = 'AdminCreateUserCommand';
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class AdminSetUserPasswordCommand {
    _type = 'AdminSetUserPasswordCommand';
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class AdminAddUserToGroupCommand {
    _type = 'AdminAddUserToGroupCommand';
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class CreateGroupCommand {
    _type = 'CreateGroupCommand';
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }

  return {
    CognitoIdentityProviderClient,
    AdminGetUserCommand,
    AdminCreateUserCommand,
    AdminSetUserPasswordCommand,
    AdminAddUserToGroupCommand,
    CreateGroupCommand,
    UserNotFoundException,
    GroupExistsException,
  };
});

// Set environment variables before importing the handler
vi.stubEnv('USER_POOL_ID', 'us-east-1_TestPool');
vi.stubEnv('ADMIN_EMAIL', 'admin@aileague.community');

// Import handler after mocks are set up (vi.mock is hoisted)
import { handler } from '../../lambda/admin-seed/index.js';
import { UserNotFoundException } from '@aws-sdk/client-cognito-identity-provider';

describe('Feature: aws-ai-league-community-edition, Property 1: Admin seed idempotency', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it('handler is a no-op when user already exists (no mutations performed)', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate random user existence states: true = user exists
        fc.boolean(),
        async (userExists: boolean) => {
          mockSend.mockReset();

          if (userExists) {
            // AdminGetUser succeeds — user exists
            mockSend.mockImplementation((command: { _type: string }) => {
              if (command._type === 'AdminGetUserCommand') {
                return Promise.resolve({
                  Username: 'admin@aileague.community',
                  UserStatus: 'CONFIRMED',
                });
              }
              // No other commands should be called when user exists
              return Promise.resolve({});
            });
          } else {
            // AdminGetUser throws UserNotFoundException — user does not exist
            mockSend.mockImplementation((command: { _type: string }) => {
              if (command._type === 'AdminGetUserCommand') {
                return Promise.reject(new UserNotFoundException());
              }
              // Allow creation commands to succeed
              return Promise.resolve({});
            });
          }

          const event = {
            RequestType: 'Create' as const,
            ServiceToken: 'arn:aws:lambda:us-east-1:123456789:function:test',
            ResponseURL: 'https://cloudformation-response.example.com',
            StackId: 'arn:aws:cloudformation:us-east-1:123456789:stack/test/guid',
            RequestId: 'unique-id-' + Math.random(),
            ResourceType: 'Custom::AdminSeed',
            LogicalResourceId: 'AdminSeed',
            ResourceProperties: {
              ServiceToken: 'arn:aws:lambda:us-east-1:123456789:function:test',
            },
          };

          const response = await handler(event);

          if (userExists) {
            // When user exists: handler should be a no-op
            // Verify SUCCESS status
            expect(response.Status).toBe('SUCCESS');

            // Verify no mutation commands were called
            const calls = mockSend.mock.calls;
            const commandTypes = calls.map(
              (call: [{ _type: string }]) => call[0]._type
            );

            // Only AdminGetUser should have been called
            expect(commandTypes).toContain('AdminGetUserCommand');
            expect(commandTypes).not.toContain('AdminCreateUserCommand');
            expect(commandTypes).not.toContain('AdminSetUserPasswordCommand');
            expect(commandTypes).not.toContain('AdminAddUserToGroupCommand');
          } else {
            // When user does not exist: handler should create the user
            expect(response.Status).toBe('SUCCESS');

            const calls = mockSend.mock.calls;
            const commandTypes = calls.map(
              (call: [{ _type: string }]) => call[0]._type
            );

            // Creation commands should have been called
            expect(commandTypes).toContain('AdminGetUserCommand');
            expect(commandTypes).toContain('AdminCreateUserCommand');
            expect(commandTypes).toContain('AdminSetUserPasswordCommand');
            expect(commandTypes).toContain('AdminAddUserToGroupCommand');
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
