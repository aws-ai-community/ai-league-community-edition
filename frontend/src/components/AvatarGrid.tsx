import Grid from '@cloudscape-design/components/grid';
import Box from '@cloudscape-design/components/box';

export const AVATAR_OPTIONS = [
  'avatar-robot-1', 'avatar-robot-2', 'avatar-robot-3',
  'avatar-cloud-1', 'avatar-cloud-2', 'avatar-cloud-3',
  'avatar-ai-1', 'avatar-ai-2', 'avatar-ai-3',
  'avatar-league-1', 'avatar-league-2', 'avatar-league-3',
] as const;

export type AvatarId = typeof AVATAR_OPTIONS[number];

const AVATAR_EMOJIS: Record<AvatarId, string> = {
  'avatar-robot-1': '🤖',
  'avatar-robot-2': '🦾',
  'avatar-robot-3': '⚙️',
  'avatar-cloud-1': '☁️',
  'avatar-cloud-2': '🌩️',
  'avatar-cloud-3': '🌤️',
  'avatar-ai-1': '🧠',
  'avatar-ai-2': '💡',
  'avatar-ai-3': '🔮',
  'avatar-league-1': '🏆',
  'avatar-league-2': '🥇',
  'avatar-league-3': '⚡',
};

export interface AvatarGridProps {
  selectedAvatar: AvatarId | null;
  onSelect: (avatarId: AvatarId) => void;
}

export function AvatarGrid({ selectedAvatar, onSelect }: AvatarGridProps) {
  return (
    <Grid
      gridDefinition={[
        { colspan: 2 }, { colspan: 2 }, { colspan: 2 },
        { colspan: 2 }, { colspan: 2 }, { colspan: 2 },
        { colspan: 2 }, { colspan: 2 }, { colspan: 2 },
        { colspan: 2 }, { colspan: 2 }, { colspan: 2 },
      ]}
    >
      {AVATAR_OPTIONS.map((avatarId) => {
        const isSelected = avatarId === selectedAvatar;
        return (
          <div
            key={avatarId}
            role="button"
            tabIndex={0}
            aria-label={`Select avatar ${avatarId}`}
            aria-pressed={isSelected}
            onClick={() => onSelect(avatarId)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(avatarId);
              }
            }}
            style={{
              cursor: 'pointer',
              border: isSelected ? '3px solid #0972d3' : '2px solid transparent',
              borderRadius: '8px',
              padding: '8px',
              textAlign: 'center',
              backgroundColor: isSelected ? 'rgba(9, 114, 211, 0.05)' : undefined,
              transition: 'border-color 0.15s ease, background-color 0.15s ease',
            }}
          >
            <Box textAlign="center">
              <div
                style={{
                  width: '64px',
                  height: '64px',
                  margin: '0 auto',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '48px',
                  lineHeight: 1,
                }}
                aria-hidden="true"
              >
                {AVATAR_EMOJIS[avatarId]}
              </div>
              <Box variant="small" color="text-body-secondary" margin={{ top: 'xxs' }}>
                {avatarId.replace('avatar-', '').replace('-', ' ')}
              </Box>
            </Box>
          </div>
        );
      })}
    </Grid>
  );
}
