# wish-model

The built-in model that answers wishes when Claude isn't available, for example on the hosted game.
It reads a wish, typos and all, and picks the game power. Rules in `src/council/local.ts` then read
the numbers and targets ("30 cats", "the nearest mummy").

    python3 -m venv .venv
    .venv/bin/pip install -r requirements.txt
    .venv/bin/python train.py       train, print the scores, write ../public/wish-model.json

- `data/wishes.jsonl`: 2,998 labelled wishes (written by AI, nothing personal)
- `train.py`: 80/20 split, made-up typos, cutting wishes into pieces, one LogisticRegression per intent, one-byte weights, test, export
- `../public/wish-model.json`: the trained model the game downloads on the first wish
- `../src/council/local.ts`: runs that model in the browser, the same way `train.py` scores it (`score_wish`, `pick_intents`)
