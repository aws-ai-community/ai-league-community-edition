import { useEffect, useState } from 'react';
import Table from '@cloudscape-design/components/table';
import Select, { SelectProps } from '@cloudscape-design/components/select';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Alert from '@cloudscape-design/components/alert';
import { getSubmissionHistory, SubmissionHistoryEntry } from '../../services/graphqlClient';
import { PREDEFINED_MAPS } from '../../data/predefinedMaps';

const mapOptions: SelectProps.Option[] = PREDEFINED_MAPS.map((m, idx) => ({
  label: m.label,
  value: `predefined-${idx}`,
}));

export default function SubmissionHistoryPage() {
  const [selectedMap, setSelectedMap] = useState<SelectProps.Option | null>(
    mapOptions[0] ?? null,
  );
  const [items, setItems] = useState<SubmissionHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedMap?.value) return;
    let cancelled = false;

    async function fetchHistory() {
      setLoading(true);
      setError(null);
      try {
        const result = await getSubmissionHistory(selectedMap!.value!);
        if (!cancelled) {
          setItems(result.GetSubmissionHistory.items ?? []);
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

    fetchHistory();
    return () => { cancelled = true; };
  }, [selectedMap]);

  return (
    <SpaceBetween size="l">
      <Header variant="h1">Submission History</Header>

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
          ariaLabel="Select map for submission history"
        />
      </Container>

      <Table
        header={<Header variant="h2">Past Submissions</Header>}
        columnDefinitions={[
          {
            id: 'submissionTime',
            header: 'Submission Time',
            cell: (item: SubmissionHistoryEntry) =>
              item.updatedTime
                ? new Date(item.updatedTime).toLocaleString()
                : '-',
            sortingField: 'updatedTime',
          },
          {
            id: 'finalScore',
            header: 'Final Score',
            cell: (item: SubmissionHistoryEntry) =>
              item.finalScore != null ? item.finalScore.toFixed(0) : '-',
            sortingField: 'finalScore',
          },
          {
            id: 'correctAnswers',
            header: 'Correct Answers',
            cell: (item: SubmissionHistoryEntry) =>
              item.correctAnswers != null ? item.correctAnswers : '-',
          },
          {
            id: 'totalChallenges',
            header: 'Total Challenges',
            cell: (item: SubmissionHistoryEntry) =>
              item.totalChallenges != null ? item.totalChallenges : '-',
          },
          {
            id: 'livesRemaining',
            header: 'Lives Remaining',
            cell: (item: SubmissionHistoryEntry) =>
              item.livesRemaining != null ? item.livesRemaining : '-',
          },
          {
            id: 'tokenBonus',
            header: 'Token Bonus',
            cell: (item: SubmissionHistoryEntry) =>
              item.givenTokenBonus != null
                ? item.givenTokenBonus.toFixed(0)
                : '-',
          },
        ]}
        items={items}
        loading={loading}
        loadingText="Loading submission history..."
        empty={
          <StatusIndicator type="info">
            No submissions yet. Play a game and submit your score!
          </StatusIndicator>
        }
        trackBy="updatedTime"
        variant="full-page"
      />
    </SpaceBetween>
  );
}
