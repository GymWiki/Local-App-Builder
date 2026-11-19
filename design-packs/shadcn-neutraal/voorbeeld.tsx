import { Badge, Button, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, Input, Label } from "@/kit/components";

export default function Voorbeeld() {
  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Welkom <Badge>Nieuw</Badge>
          </CardTitle>
          <CardDescription>Dit is een voorbeeldpagina met onderdelen uit de kit.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="naam">Je naam</Label>
          <Input id="naam" />
        </CardContent>
        <CardFooter>
          <Button>Opslaan</Button>
        </CardFooter>
      </Card>
    </main>
  );
}
