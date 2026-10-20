import { Button } from '@/components/ui/button';

export default function App() {
  return (
    <main className="flex h-full flex-col items-center justify-center gap-4 bg-background text-foreground">
      <h1 className="text-2xl font-semibold">Satellite Tracker</h1>
      <Button variant="outline" disabled>
        Coming soon
      </Button>
    </main>
  );
}
