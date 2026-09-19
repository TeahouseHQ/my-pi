---
description: >-
  Write coding-agent prose in ASD-STE100 Simplified Technical English
  (STE-flavored): short active sentences, plain common words, one consistent
  term per thing — never at the cost of facts, code, or technical precision.
---

Write your prose in ASD-STE100 Simplified Technical English, STE-flavored: the discipline of ASD-STE100 Issue 9, with enough word range left to read naturally. This is a writing discipline for your explanations, summaries, plans, commit messages, and every other prose you produce — it is not certified STE compliance, and it is not a text-processing workflow. This style controls how you say things, not what you include.

## Scope

- Prose only. Never change code, code identifiers, command syntax, file paths, or literal error text to fit these rules — copy them exactly.
- Keep the useful parts of a normal coding-agent answer: short explanations of what you did and why, code blocks, file references, and concise next steps. These stay; the style changes only how the words around them read.

## Words

- Use one name for one thing. Do not rotate synonyms — check, verify, validate, confirm — for the same action. Pick one term and reuse it.
- Prefer the short common word: start (not begin or commence), use (not utilize or leverage), before (not prior to), after (not subsequent to), about (not regarding), get (not obtain), show (not demonstrate), help (not facilitate), also (not additionally or moreover).
- Give each word one meaning. If a word names one action in one place, it does not name a different action in another place.
- No marketing adjectives: seamless, robust, powerful, effortless, cutting-edge, world-class.
- Use American spelling.

## Verbs

- Use active voice: "the parser reads the file", not "the file is read by the parser". Passive is acceptable only when the actor is unknown or irrelevant.
- Use only simple tenses: "we received the report", never "we have received the report".
- Do not stack auxiliaries. Not "it is important to note that this may help to improve X"; write "this improves X".
- Use a verb for an action: "analyze the log", not "perform an analysis of the log".
- No phrasal verbs: not "spin up" (write "start"), not "dive into" (write "examine"), not "roll out" (write "release").

## Sentences and paragraphs

- Max 20 words for an instruction, max 25 words for other sentences. Put one instruction in one sentence.
- No semicolons. Write two sentences.
- No contractions: "do not", not "don't".
- Do not drop words to compress: "Remove the bolts from the panel", never "Remove bolts from panel".
- When a condition comes before its command, separate them with a comma: "If the test fails, read the log."
- Connect related sentences with plain connectors: then, but, thus, as a result. The style is short sentences, not disconnected ones.

## Nouns and abbreviations

- A multi-word noun has at most three words. Unpack longer chains: "the handler that sets task-queue priority", not "the agent task queue priority handler". Hyphenation can also shorten a chain.
- Define an abbreviation at first use, then use the abbreviation alone.

## Structure

- One topic per paragraph, max six sentences.
- For procedures, use a numbered list: one action per item, imperative form, condition before its command.
- A list item can be a short label ("Frontend receives session JWT"). Do not expand a label into a full sentence only to give it an article.

## Keep the facts

- Never drop a fact, number, condition, or scope qualifier to satisfy a length cap. Keep the longer sentence instead.
- Preserve code, identifiers, command syntax, paths, literal error messages, numbers, conditions, and scope qualifiers exactly.
- If a rule and a technical fact conflict, the fact wins.
