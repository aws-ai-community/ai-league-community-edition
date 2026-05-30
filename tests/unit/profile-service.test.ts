import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getProfile, updateProfile, ProfileUpdateError } from '../../frontend/src/services/profileService';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('profileService', () => {
  describe('getProfile', () => {
    it('returns profile data on successful response', async () => {
      const profile = { userId: 'user-123', displayName: 'Alice', avatar: 'avatar-robot-1' };
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(profile),
      });

      const result = await getProfile('test-token');

      expect(result).toEqual(profile);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/profile'),
        expect.objectContaining({
          method: 'GET',
          headers: { Authorization: 'Bearer test-token' },
        })
      );
    });

    it('throws ProfileUpdateError with status code on failure', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: 'Unauthorized' }),
      });

      await expect(getProfile('bad-token')).rejects.toThrow(ProfileUpdateError);
      await expect(getProfile('bad-token')).rejects.toMatchObject({
        message: 'Unauthorized',
        statusCode: 401,
      });
    });

    it('handles non-JSON error responses gracefully', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error('not json')),
      });

      await expect(getProfile('token')).rejects.toMatchObject({
        message: 'Failed to fetch profile',
        statusCode: 500,
      });
    });
  });

  describe('updateProfile', () => {
    it('returns updated profile on success', async () => {
      const updated = { userId: 'user-123', displayName: 'Bob', avatar: 'avatar-ai-1' };
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(updated),
      });

      const result = await updateProfile('test-token', { displayName: 'Bob' });

      expect(result).toEqual(updated);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/profile'),
        expect.objectContaining({
          method: 'PUT',
          headers: {
            Authorization: 'Bearer test-token',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ displayName: 'Bob' }),
        })
      );
    });

    it('throws ProfileUpdateError with status code on validation failure', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: 'Display name must be between 1 and 50 characters' }),
      });

      await expect(updateProfile('token', { displayName: '' })).rejects.toThrow(ProfileUpdateError);
      await expect(updateProfile('token', { displayName: '' })).rejects.toMatchObject({
        message: 'Display name must be between 1 and 50 characters',
        statusCode: 400,
      });
    });

    it('handles non-JSON error responses gracefully', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error('not json')),
      });

      await expect(updateProfile('token', { avatar: 'avatar-robot-1' })).rejects.toMatchObject({
        message: 'Update failed',
        statusCode: 500,
      });
    });
  });

  describe('ProfileUpdateError', () => {
    it('has correct name, message, and statusCode', () => {
      const error = new ProfileUpdateError('Something went wrong', 422);

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('ProfileUpdateError');
      expect(error.message).toBe('Something went wrong');
      expect(error.statusCode).toBe(422);
    });
  });
});
