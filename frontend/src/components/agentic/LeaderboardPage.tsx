import { useEffect, useState } from 'react';
import Table from '@cloudscape-design/components/table';
import Select, { SelectProps } from '@cloudscape-design/components/select';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Alert from '@cloudscape-design/components/alert';
import { getLeaderboardSubmissions, LeaderboardEntry } from '../../services/graphqlClient';
import { PREDEFINED_MAPS } from '../../data/predefinedMaps';
import { AVATAR_IMAGES, AvatarId } from '../../assets/avatars/avatars';

const mapOptions: SelectProps.Option[] = PREDEFINED_MAPS.map((m, idx) => ({
  label: m.label,
  value: `map#predefined-${idx}`,
}));

export default function LeaderboardPage() {
  const [selectedMap, setSelectedMap] = useState<SelectProps.Option | null>(
    mapOptions[0] ?? null,
  );
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedMap?.value) return;
    let cancelled = false;

    async function fetchLeaderboard() {
      setLoading(true);
      setError(null);
      try {
        const result = await getLeaderboardSubmissions(selectedMap!.value!);
        if (!cancelled) {
          setEntries(result.GetLeaderboardSubmissions.entries ?? []);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchLeaderboard();
    return () => { cancelled = true; };
  }, [selectedMap]);

  return (
    <SpaceBetween size="l">
      <Header variant="h1">Leaderboard</Header>

      {error && (
        <Alert type="error" dismissible onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Container header={<Header variant="h2">Map Selection</Header>}>
        <Select
          selectedOption={selectedMap}
          onChange={({ detail }) => setSelectedMap(detail.selectedOption)}
          options={mapOptions}
          placeholder="Select a map"
          ariaLabel="Select map for leaderboard"
        />
      </Container>

      <Table
        header={<Header variant="h2">Rankings</Header>}
        columnDefinitions={[
          {
            id: 'rank',
            header: 'Rank',
            cell: (item: LeaderboardEntry) => item.rank ?? '-',
            sortingField: 'rank',
            width: 80,
          },
          {
            id: 'alias',
            header: 'Alias',
            cell: (item: LeaderboardEntry) => item.alias ?? 'Anonymous',
          },
          {
            id: 'avatar',
            header: 'Avatar',
            cell: (item: LeaderboardEntry) =>
              item.avatar ? (
                <img
                  src={AVATAR_IMAGES[item.avatar as AvatarId] ?? item.avatar}
                  alt={item.alias ?? 'avatar'}
                  style={{ width: 32, height: 32, borderRadius: '50%' }}
                />
              ) : (
                '-'
              ),
            width: 80,
          },
          {
            id: 'bestScore',
            header: 'Best Score',
            cell: (item: LeaderboardEntry) =>
              item.bestScore != null ? item.bestScore.toFixed(0) : '-',
            sortingField: 'bestScore',
          },
          {
            id: 'lastScore',
            header: 'Last Score',
            cell: (item: LeaderboardEntry) =>
              item.lastScore != null ? item.lastScore.toFixed(0) : '-',
          },
          {
            id: 'totalSubmissions',
            header: 'Total Submissions',
            cell: (item: LeaderboardEntry) => item.totalSubmissions ?? 0,
          },
        ]}
        items={entries}
        loading={loading}
        loadingText="Loading leaderboard..."
        empty={
          <StatusIndicator type="info">
            No leaderboard entries yet. Be the first to submit a score!
          </StatusIndicator>
        }
        trackBy="userId"
        variant="full-page"
      />
    </SpaceBetween>
  );
}
