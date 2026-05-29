import avatarRobot1 from './avatar-robot-1.svg';
import avatarRobot2 from './avatar-robot-2.svg';
import avatarRobot3 from './avatar-robot-3.svg';
import avatarCloud1 from './avatar-cloud-1.svg';
import avatarCloud2 from './avatar-cloud-2.svg';
import avatarCloud3 from './avatar-cloud-3.svg';
import avatarAi1 from './avatar-ai-1.svg';
import avatarAi2 from './avatar-ai-2.svg';
import avatarAi3 from './avatar-ai-3.svg';
import avatarLeague1 from './avatar-league-1.svg';
import avatarLeague2 from './avatar-league-2.svg';
import avatarLeague3 from './avatar-league-3.svg';

export const AVATAR_OPTIONS = [
  'avatar-robot-1',
  'avatar-robot-2',
  'avatar-robot-3',
  'avatar-cloud-1',
  'avatar-cloud-2',
  'avatar-cloud-3',
  'avatar-ai-1',
  'avatar-ai-2',
  'avatar-ai-3',
  'avatar-league-1',
  'avatar-league-2',
  'avatar-league-3',
] as const;

export type AvatarId = (typeof AVATAR_OPTIONS)[number];

export const AVATAR_IMAGES: Record<AvatarId, string> = {
  'avatar-robot-1': avatarRobot1,
  'avatar-robot-2': avatarRobot2,
  'avatar-robot-3': avatarRobot3,
  'avatar-cloud-1': avatarCloud1,
  'avatar-cloud-2': avatarCloud2,
  'avatar-cloud-3': avatarCloud3,
  'avatar-ai-1': avatarAi1,
  'avatar-ai-2': avatarAi2,
  'avatar-ai-3': avatarAi3,
  'avatar-league-1': avatarLeague1,
  'avatar-league-2': avatarLeague2,
  'avatar-league-3': avatarLeague3,
};
