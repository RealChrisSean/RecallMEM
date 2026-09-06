# Memory The Model Can't Fake

_RecallMEM now makes memory stricter on purpose._

AI memory has a quiet failure mode.

Forgetting is obvious. You ask about something from last week, the assistant has no idea, and everybody knows what happened.

False memory is worse. The assistant remembers a city, a job, a project, a model name, a financial detail. It sounds useful because it sounds personal. But if that memory was never said, the app just became confidently familiar.

So we changed RecallMEM's memory layer to be less magical.

The rule is simple:

No quote, no memory.

## The Model Proposes. The App Checks.

RecallMEM already had a hard boundary around memory. The chat model does not query Postgres. It does not browse pgvector. It does not get a tool that lets it rummage through your private database. TypeScript builds the context first. Then the model answers.

Writes work the same way. A background model can propose candidate memories, but it does not write rows. The app validates, deduplicates, categorizes, embeds, and only then inserts.

Before, the extractor could return this:

```json
{
  "facts": [
    "User lives in Example City."
  ]
}
```

That is valid JSON. It is not proof.

Now the extractor has to bring a receipt:

```json
{
  "facts": [
    {
      "text": "User lives in Example City.",
      "quote": "I live in Example City now."
    }
  ]
}
```

Then TypeScript checks the quote against the transcript. If the quote is not there, the memory is rejected.

This does not prove the user really lives in Example City. It proves something narrower and more useful: the memory is supported by the conversation.

If the model invents:

```json
{
  "text": "User collects antique maps.",
  "quote": "I collect antique maps."
}
```

but the transcript never says that, the memory dies before Postgres ever sees it.

The model can still hallucinate. It just cannot make the database believe it.

## Time Is Part Of The Fact

Receipts fix one kind of fake memory. Time fixes another.

This sentence looks harmless:

```text
User: My new job starts in 1 month.
```

Before, a model could store:

```text
User's new job starts in 1 month.
```

That memory gets worse every morning.

RecallMEM now gives the extractor the conversation date and requires relative time to be grounded. If the conversation happened on `2030-01-15`, the memory needs to look like this:

```text
User said on 2030-01-15 that their new job starts around 2030-02-15.
```

If the extractor leaves it as "in 1 month", TypeScript rejects it.

That is intentionally conservative. Missing a memory is annoying. Storing a stale personal fact is worse.

## Vectors Are Not Enough

We also changed retrieval.

Vector search is great at meaning. If you ask "what voice thing were we building?", pgvector can find old voice-agent conversations.

But meaning is not exactness.

Model IDs, branch names, errors, prices, migrations, and weird product names are not vibes. This should be retrievable because the exact string exists:

```text
grok-4.20-0309-reasoning
```

Before, embedding search might miss that. Now RecallMEM uses hybrid retrieval: pgvector for semantic recall, plus Postgres text search over facts, transcript chunks, and receipt quotes.

The voice agent gets the same upgrade. It can receive semantic, keyword, and receipt-backed matches.

## Small Boring Fixes That Matter

The memory page now shows receipts under facts. Instead of arguing with the model about whether it knows something, you can inspect the memory layer directly.

External ingest got fixed too. It used to pass a source name like `notion` or `gmail` where a chat UUID belonged. Now it creates a real deterministic chat row, then embeds chunks against that chat.

Here is the short version:

| Situation | Before | After |
|---|---|---|
| LLM invents a fact | Could store if it looked valid | Rejected without a transcript quote |
| "Starts in 1 month" | Could stay vague forever | Must become a concrete date |
| Exact model string | Vector search might miss it | Keyword and receipt search catch it |
| Voice memory | Mostly semantic | Semantic, keyword, receipt-backed |
| External ingest | Fake chat IDs could break chunks | Real deterministic chat rows |

This is not about making memory feel more impressive.

It is about making memory harder to fake.

Better models still help. They propose better facts. But RecallMEM should not need blind faith in the model to keep the database clean. The model can talk. The app keeps the receipts.
