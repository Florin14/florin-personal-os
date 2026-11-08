import { Field, Input } from '@/components/ui/form';

/** Six-digit one-time code input. */
export function CodeField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label="6-digit code" required>
      {(props) => (
        <Input
          {...props}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
          autoComplete="one-time-code"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          className="text-center font-mono text-lg tracking-[0.5em]"
        />
      )}
    </Field>
  );
}
