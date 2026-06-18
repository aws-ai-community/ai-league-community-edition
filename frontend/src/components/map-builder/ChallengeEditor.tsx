import { useMemo, useState } from 'react';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import Textarea from '@cloudscape-design/components/textarea';
import Select, { SelectProps } from '@cloudscape-design/components/select';
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { TILE_METADATA, TileKey } from './tileData';
import { getQuestionsForTileType, QuestionBankEntry, computeC3Answer, isMapDependentAnswer } from '../../data/questionBank';

export interface ChallengeAssignment {
  type: string;
  question: string;
  expectedAnswer: string;
  gradingStrategy: string;
}

export interface ChallengeEditorProps {
  challenges: Record<string, ChallengeAssignment>;
  onChallengesChange: (challenges: Record<string, ChallengeAssignment>) => void;
  grid: string[][];
}

const GRADING_STRATEGIES: SelectProps.Option[] = [
  { label: 'Exact Match', value: 'exact_match' },
  { label: 'Contains Match', value: 'contains_match' },
  { label: 'JSON Exact Match', value: 'json_exact_match' },
  { label: 'Guardrail Block', value: 'guardrail_block' },
];

// Tile types that have challenges assigned to them
const CHALLENGE_TILE_TYPES = new Set([
  'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8',
  'c17', 'c18',
  'c30', 'c31', 'c32', 'c33',
  'c40', 'c41', 'c42', 'c43',
]);

// Passive tiles that don't need question editing (no challenge interaction)
const PASSIVE_TILES = new Set(['c7', 'c8']);

export default function ChallengeEditor({ challenges, onChallengesChange, grid }: ChallengeEditorProps) {
  // Find all challenge tile positions in the grid
  const challengePositions = useMemo(() => {
    const positions: { row: number; col: number; type: string; key: string }[] = [];
    for (let row = 0; row < grid.length; row++) {
      for (let col = 0; col < grid[row].length; col++) {
        const cell = grid[row][col];
        if (CHALLENGE_TILE_TYPES.has(cell) && !PASSIVE_TILES.has(cell)) {
          positions.push({ row, col, type: cell, key: `${row},${col}` });
        }
      }
    }
    return positions;
  }, [grid]);

  const updateChallenge = (posKey: string, type: string, updates: Partial<ChallengeAssignment>) => {
    const existing = challenges[posKey] || { type, question: '', expectedAnswer: '', gradingStrategy: 'contains_match' };
    const updated = { ...existing, ...updates };
    onChallengesChange({ ...challenges, [posKey]: updated });
  };

  const handleQuestionBankSelect = (posKey: string, type: string, entry: QuestionBankEntry | null) => {
    if (!entry) return;

    let expectedAnswer = entry.expectedAnswer;

    // For c3 (Memento) questions, compute the answer from the current grid
    if (isMapDependentAnswer(entry)) {
      const computed = computeC3Answer(entry.question, grid);
      expectedAnswer = computed ?? '(could not compute — please enter manually)';
    }

    updateChallenge(posKey, type, {
      question: entry.question,
      expectedAnswer,
      gradingStrategy: entry.gradingStrategy,
    });
  };

  const [generating, setGenerating] = useState<string | null>(null);

  const handleAutoGenerate = async (posKey: string, tileType: string) => {
    setGenerating(posKey);
    try {
      // c3 (Memento) is map-dependent — generate locally from grid
      if (tileType === 'c3') {
        const c3Questions = getQuestionsForTileType('c3');
        if (c3Questions.length > 0) {
          const entry = c3Questions[Math.floor(Math.random() * c3Questions.length)];
          const computed = computeC3Answer(entry.question, grid);
          onChallengesChange({
            ...challenges,
            [posKey]: {
              type: tileType,
              question: entry.question,
              expectedAnswer: computed ?? '(could not compute)',
              gradingStrategy: entry.gradingStrategy,
            },
          });
        } else {
          alert('No Memento questions available for this map.');
        }
        return;
      }

      const { generateChallenge } = await import('../../services/graphqlClient');
      const result = await generateChallenge(tileType);
      const gen = result.GenerateChallenge;

      const updatedChallenges = {
        ...challenges,
        [posKey]: {
          type: tileType,
          question: gen.question,
          expectedAnswer: gen.expectedAnswer,
          gradingStrategy: gen.gradingStrategy,
        },
      };

      // If there's a paired challenge (key/door), find the matching tile and populate it
      if (gen.pairedTileType && gen.pairedQuestion && gen.pairedExpectedAnswer) {
        const pairedPos = challengePositions.find((p) => p.type === gen.pairedTileType);
        if (pairedPos) {
          updatedChallenges[pairedPos.key] = {
            type: gen.pairedTileType,
            question: gen.pairedQuestion,
            expectedAnswer: gen.pairedExpectedAnswer,
            gradingStrategy: gen.pairedGradingStrategy || 'exact_match',
          };
        }
      }

      onChallengesChange(updatedChallenges);
    } catch (err) {
      alert(`Failed to generate challenge: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setGenerating(null);
    }
  };

  if (challengePositions.length === 0) {
    return (
      <Container header={<Header variant="h3">Challenge Editor</Header>}>
        <p>No challenge tiles on the map. Place challenge tiles (c1–c18, c30–c33, c40–c43) to assign questions.</p>
      </Container>
    );
  }

  return (
    <Container header={<Header variant="h3">Challenge Editor</Header>}>
      <SpaceBetween size="l">
        {challengePositions.map(({ row, col, type, key: posKey }) => {
          const metadata = TILE_METADATA[type as TileKey];
          const assignment = challenges[posKey] || { type, question: '', expectedAnswer: '', gradingStrategy: 'contains_match' };
          const questionsForType = getQuestionsForTileType(type);

          // Build question bank options for the select dropdown
          const questionBankOptions: SelectProps.Option[] = questionsForType.map((entry, idx) => ({
            label: entry.question.length > 80 ? entry.question.substring(0, 80) + '…' : entry.question,
            value: String(idx),
            description: `Answer: ${entry.expectedAnswer}`,
          }));

          // Find the currently selected question bank entry (if any)
          // Note: for map-dependent (c3) questions, expectedAnswer is computed and won't match the bank value,
          // so we match on question text only.
          const selectedQuestionIdx = questionsForType.findIndex(
            (e) => e.question === assignment.question
          );
          const selectedQuestionOption = selectedQuestionIdx >= 0
            ? questionBankOptions[selectedQuestionIdx]
            : null;

          // Find the currently selected grading strategy
          const selectedStrategy = GRADING_STRATEGIES.find((s) => s.value === assignment.gradingStrategy) || GRADING_STRATEGIES[1];

          return (
            <div key={posKey} style={{ borderBottom: '1px solid #e9ebed', paddingBottom: '16px' }}>
              <SpaceBetween size="s">
                <strong>{metadata?.name || type} — Position [{row}, {col}]</strong>

                {questionBankOptions.length > 0 && (
                  <FormField label="Question Bank">
                    <SpaceBetween size="xs" direction="horizontal">
                      <div style={{ flex: 1 }}>
                        <Select
                          selectedOption={selectedQuestionOption}
                          onChange={({ detail }) => {
                            const idx = Number(detail.selectedOption.value);
                            handleQuestionBankSelect(posKey, type, questionsForType[idx] ?? null);
                          }}
                          options={questionBankOptions}
                          placeholder="Select from question bank..."
                          filteringType="auto"
                        />
                      </div>
                      <Button onClick={() => handleAutoGenerate(posKey, type)} iconName="gen-ai" loading={generating === posKey}>
                        Auto-Generate
                      </Button>
                    </SpaceBetween>
                  </FormField>
                )}

                <FormField label="Question">
                  <Textarea
                    value={assignment.question}
                    onChange={({ detail }) => updateChallenge(posKey, type, { question: detail.value })}
                    placeholder="Enter the challenge question..."
                    rows={3}
                  />
                </FormField>

                <FormField label="Expected Answer">
                  <Textarea
                    value={assignment.expectedAnswer}
                    onChange={({ detail }) => updateChallenge(posKey, type, { expectedAnswer: detail.value })}
                    placeholder="Enter the expected answer..."
                    rows={2}
                  />
                </FormField>

                <FormField label="Grading Strategy">
                  <Select
                    selectedOption={selectedStrategy}
                    onChange={({ detail }) => updateChallenge(posKey, type, { gradingStrategy: detail.selectedOption.value || 'contains_match' })}
                    options={GRADING_STRATEGIES}
                  />
                </FormField>
              </SpaceBetween>
            </div>
          );
        })}
      </SpaceBetween>
    </Container>
  );
}
