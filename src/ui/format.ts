/** CelesTrak may leave names or designators blank; show a placeholder instead. */
export function orPlaceholder(value: string | undefined, placeholder: string): string {
  return value === undefined || value.trim() === '' ? placeholder : value;
}

export const displayName = (name: string | undefined) => orPlaceholder(name, '(unnamed)');
