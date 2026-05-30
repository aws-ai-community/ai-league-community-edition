/**
 * Truncates a string to a maximum of 30 visible characters,
 * appending an ellipsis (…) if the original exceeds 30 characters.
 */
export function truncateDisplayName(name: string): string {
  if (name.length > 30) {
    return name.slice(0, 30) + '…';
  }
  return name;
}
