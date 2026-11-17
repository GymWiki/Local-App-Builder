import { Button, Card, Field, Input, Stack, Text } from "@usefragments/ui";

export default function Voorbeeld() {
  return (
    <Stack gap="md">
      <Card>
        <Card.Header>
          <Card.Title>Welkom</Card.Title>
        </Card.Header>
        <Card.Body>
          <Stack gap="md">
            <Text>Dit is een voorbeeldpagina met onderdelen uit de kit.</Text>
            <Field>
              <Field.Label>Je naam</Field.Label>
              <Input />
            </Field>
          </Stack>
        </Card.Body>
        <Card.Footer>
          <Button>Opslaan</Button>
        </Card.Footer>
      </Card>
    </Stack>
  );
}
