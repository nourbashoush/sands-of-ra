# Train the Sands of Ra wish model, test it, and export it to ../public/wish-model.json for the game.
# src/council/local.ts reads wishes with it in the browser, the same way score_wish and pick_intents do here.
# Run: .venv/bin/python train.py

import base64
import json
import random
import re
import unicodedata

import numpy as np
from scipy.sparse import csr_matrix
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import normalize

INTENTS = [
    "summon_cats",
    "smite",
    "entomb",
    "banish",
    "transform",
    "purify",
    "shield",
    "slow_time",
    "reveal",
    "bless",
    "ascend",
    "defeat_boss",
    "reshape",
    "none",
]


# "Smite THEM!!" -> "smite them"
def normalise(text):
    text = text.lower()

    # Split accented characters: "café" -> "cafe"
    text = unicodedata.normalize("NFKD", text)
    plain = ""
    for character in text:
        if not unicodedata.combining(character):
            plain += character
    text = plain  

    text = re.sub(r"\?+", " ? ", text)  # register "?" as its own word
    text = re.sub(r"[^a-z0-9? ]", " ", text)  # replace non-alphanumeric characters with spaces

    words = text.split()
    return " ".join(words)


# " cat ", 3 -> [" ca", "cat", "at "]
# ["send", "30", "cats"], 2 -> [["send", "30"], ["30", "cats"]]
def ngrams(sequence, n):
    out = []
    for start in range(len(sequence) - n + 1):
        out.append(sequence[start:start + n])
    return out


# ["send", "30", "cats"] -> ["w:send", "w:30", "w:cats"]
def word_pieces(words):
    out = []
    for word in words:
        out.append("w:" + word)
    return out


# ["send", "30", "cats", "please"] -> ["p:send 30", "p:30 cats"]
def pair_pieces(words):
    out = []
    for pair in ngrams(words, 2):
        out.append("p:" + " ".join(pair))  
    return out


# "cat" -> [" c", "ca", "at", "t ", " ca", "cat", "at ", " cat", "cat "]
def chunk_pieces(word):
    padded = " " + word + " "
    out = []
    for size in (2, 3, 4):
        out += ngrams(padded, size)
    return out


# "Send 30 cats!" -> ["w:send", "w:30", "w:cats", "p:send 30", "p:30 cats", " s", "se", ..., "cats "]
def pieces(text):
    words = normalise(text).split()
    out = word_pieces(words) + pair_pieces(words)
    for word in words:
        out += chunk_pieces(word)
    return out



NEARBY_KEYS = {
    "a": "qsz", "b": "vn", "c": "xv", "d": "sf", "e": "wr", "f": "dg", "g": "fh", "h": "gj",
    "i": "uo", "j": "hk", "k": "jl", "l": "k", "m": "n", "n": "bm", "o": "ip", "p": "o",
    "q": "w", "r": "et", "s": "ad", "t": "ry", "u": "yi", "v": "cb", "w": "qe", "x": "zc",
    "y": "tu", "z": "x",
}

def hit_nearby_key(letters, i, rng):
    letter = letters[i].lower()
    if letter in NEARBY_KEYS:
        letters[i] = rng.choice(NEARBY_KEYS[letter])

def drop_letter(letters, i):
    del letters[i]


def double_letter(letters, i):
    letters.insert(i, letters[i].lower())


def swap_with_next(letters, i):
    letters[i], letters[i + 1] = letters[i + 1], letters[i]


# Pick one kind of slip at random and make it: 25% drop, 20% double, 25% swap, 30% nearby key.
def make_slip(letters, i, rng):
    roll = rng.random()
    if roll < 0.25:
        drop_letter(letters, i)
    elif roll < 0.45:
        double_letter(letters, i)
    elif roll < 0.7 and i + 1 < len(letters):
        swap_with_next(letters, i)
    else:
        hit_nearby_key(letters, i, rng)


# "send 30 cats" -> "sned 30 cats"
def add_typos(text, rng):
    letters = list(text)  # a list, so single letters can be changed
    slips = 1 + rng.randrange(max(1, len(text) // 12))
    for _ in range(slips):
        i = rng.randrange(len(letters))
        if letters[i].isalpha():
            make_slip(letters, i, rng)
    return "".join(letters)


def with_typos(rows, rng):
    out = []
    for row in rows:
        out.append(row)
        for _ in range(3):
            out.append({"text": add_typos(row["text"], rng), "intents": row["intents"]})
    return out


# ["send cats", "cats pls"] -> {" c": 0, " ca": 1, " cat": 2, ...} (pieces in 2+ different wishes, typo copies count)
def find_real_pieces(wishes):
    wishes_with = {}
    for text in wishes:
        for piece in set(pieces(text)):
            wishes_with[piece] = wishes_with.get(piece, 0) + 1

    kept = []
    for piece, count in wishes_with.items():
        if count >= 2:
            kept.append(piece)

    kept.sort()

    real_pieces = {}
    for slot, piece in enumerate(kept):
        real_pieces[piece] = slot
    return real_pieces


def count_pieces(wishes, real_pieces):
    rows = []  # wish (row)
    slots = []  # ... piece (column)
    counts = []  # ... count of piece in wish

    for row, text in enumerate(wishes):
        tally = {}

        for piece in pieces(text):
            if piece in real_pieces:
                slot = real_pieces[piece]
                tally[slot] = tally.get(slot, 0) + 1

        for slot, count in tally.items():
            rows.append(row)
            slots.append(slot)
            counts.append(count)

    X = csr_matrix((counts, (rows, slots)), shape=(len(wishes), len(real_pieces)), dtype=float)
    return normalize(X)


# counts and intents -> weights and biases, learned as one yes/no model per intent
def train(X, intents):
    weights = []
    biases = []
    for intent in INTENTS:
        y = []
        for wish_intents in intents:
            if intent in wish_intents:
                y.append(1)
            else:
                y.append(0)

        model = LogisticRegression(C=10, max_iter=2000)
        model.fit(X, np.array(y))

        weights.append(model.coef_[0])
        biases.append(model.intercept_[0])

    return np.array(weights), np.array(biases)


# Round weights to whole number from -127 to 127 to fit in one byte.
def quantise(weights):
    biggest = np.max(np.abs(weights))
    scale = float(biggest / 127)
    small = np.round(weights / scale).astype(np.int8)
    return small, scale


# "send me 30 kittys" -> [0.999, 0.0006, ...]
def score_wish(wish, real_pieces, weights, biases):
    x = np.zeros(len(real_pieces))
    for piece in pieces(wish):
        if piece in real_pieces:
            x[real_pieces[piece]] += 1

    length = np.sqrt(np.sum(x * x))
    if length > 0:
        x = x / length

    z = weights @ x + biases
    return 1 / (1 + np.exp(-z))


def pick_intents(wish, real_pieces, weights, biases):
    scores = score_wish(wish, real_pieces, weights, biases)
    ranked = np.argsort(-scores)  # intent numbers, highest score first
    best = INTENTS[ranked[0]]
    second = INTENTS[ranked[1]]

    picked = [best]

    if scores[ranked[1]] > 0.5 and best != "none" and second != "none":
        picked.append(second)
    return picked



def test_model(test_rows, real_pieces, weights, biases):
    right_firsts = []
    picked_firsts = []
    first_right = 0  # correct first picks
    exactly_right = 0  # correct intents

    for row in test_rows:
        wish = row["text"]
        picked = pick_intents(wish, real_pieces, weights, biases)
        right_intents = row["intents"]

        right_firsts.append(right_intents[0])
        if picked[0] in right_intents:
            picked_firsts.append(right_intents[0])  # right: record it as the expected answer
            first_right += 1
        else:
            picked_firsts.append(picked[0])  # wrong: record what it picked instead

        if sorted(picked) == sorted(right_intents):
            exactly_right += 1

    print(f"\nTest: {len(test_rows)} wishes it never saw")
    print(f"  First Pick Right: {first_right / len(test_rows):.1%}")
    print(f"  Exactly Right: {exactly_right / len(test_rows):.1%}\n")

    print(classification_report(right_firsts, picked_firsts, labels=INTENTS, zero_division=0, digits=3))

    print("confusion matrix (rows: right intent, columns: the model's pick)")
    matrix = confusion_matrix(right_firsts, picked_firsts, labels=INTENTS)
    header = " " * 8
    for intent in INTENTS:
        header += f"{intent[:6]:>7}"
    print(header)
    for intent, counts in zip(INTENTS, matrix):
        line = f"{intent[:6]:<8}"
        for count in counts:
            line += f"{(str(count) if count else '.'):>7}"
        print(line)



def export(path, real_pieces, small_weights, biases, scale):
    pieces_in_order = [""] * len(real_pieces)
    for piece, slot in real_pieces.items():
        pieces_in_order[slot] = piece

    model = {
        "labels": INTENTS,
        "pieces": pieces_in_order,
        "bias": biases.tolist(),
        "scale": scale,
        "weights": base64.b64encode(small_weights.tobytes()).decode(),
    }
    with open(path, "w") as f:
        json.dump(model, f)
    print(f"\nexported {path}: {len(real_pieces)} pieces x {len(INTENTS)} intents")


def main():
    rows = []
    with open("data/wishes.jsonl") as f:
        for line in f:
            if line.strip():  # skip blank lines
                rows.append(json.loads(line))

    train_rows, test_rows = train_test_split(rows, test_size=0.2, random_state=42)

    train_rows = with_typos(train_rows, random.Random(1))

    wishes = []
    intents = []
    for row in train_rows:
        wishes.append(row["text"])
        intents.append(row["intents"])

    real_pieces = find_real_pieces(wishes)  # the tally sheet's rows: the input size
    X = count_pieces(wishes, real_pieces)  # every training wish as a row of counts
    print(f"trained on {len(wishes) // 4} wishes ({len(wishes)} with typo copies), {len(real_pieces)} pieces")

    weights, biases = train(X, intents)  # the learning
    small_weights, scale = quantise(weights)  # shrink to one byte each

    # Test with the one-byte weights (turned back into real numbers), because that's what the game uses.
    test_model(test_rows, real_pieces, small_weights * scale, biases)
    export("../public/wish-model.json", real_pieces, small_weights, biases, scale)


if __name__ == "__main__":
    main()
