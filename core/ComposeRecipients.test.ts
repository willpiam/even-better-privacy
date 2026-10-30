import { assertEquals } from "jsr:@std/assert@^1.0.6";
import {
  type ComposeChipState,
  deriveComposeIntent,
  parseAddressList,
} from "./ComposeRecipients.ts";
import * as guiMirror from "../gui/js/compose-recipients-logic.js";

type ParseCase = {
  name: string;
  text: string;
  existing: string[];
  expected: { email: string; valid: boolean }[];
};

type IntentCase = {
  name: string;
  states: ComposeChipState[];
  kind: string;
  reason?: string;
};

const fixture = JSON.parse(
  await Deno.readTextFile(
    new URL("./tests/fixtures/compose-recipients.json", import.meta.url),
  ),
) as { parseAddressList: ParseCase[]; deriveComposeIntent: IntentCase[] };

const implementations = [
  { label: "core", parseAddressList, deriveComposeIntent },
  {
    label: "gui mirror",
    parseAddressList: guiMirror.parseAddressList,
    deriveComposeIntent: guiMirror.deriveComposeIntent,
  },
];

for (const impl of implementations) {
  for (const testCase of fixture.parseAddressList) {
    Deno.test(`[${impl.label}] parseAddressList ${testCase.name}`, () => {
      assertEquals(
        impl.parseAddressList(testCase.text, testCase.existing),
        testCase.expected,
      );
    });
  }

  for (const testCase of fixture.deriveComposeIntent) {
    Deno.test(`[${impl.label}] deriveComposeIntent ${testCase.name}`, () => {
      const intent = impl.deriveComposeIntent(
        testCase.states.map((state) => ({ state })),
      );
      assertEquals(intent.kind, testCase.kind);
      if (testCase.reason) {
        assertEquals((intent as { reason?: string }).reason, testCase.reason);
      }
    });
  }
}

Deno.test("core and gui mirror return identical blocked messages", () => {
  for (const testCase of fixture.deriveComposeIntent) {
    const chips = testCase.states.map((state) => ({ state }));
    assertEquals(
      guiMirror.deriveComposeIntent(chips),
      deriveComposeIntent(chips),
    );
  }
});
