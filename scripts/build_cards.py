"""Builds cards.json from the raw per-domain extracts in data/raw/.

Card IDs are stable (lesson id + type + index) so saved progress keeps
matching cards when the deck is rebuilt. Only append new items to the
end of a lesson's lists if you edit the raw files.
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"

domains, cards = [], []

for n in range(1, 6):
    d = json.loads((RAW / f"d{n}.json").read_text())
    domains.append({"id": d["domain"], "name": d["name"], "weight": d["weight"],
                    "lessons": [{"id": l["id"], "title": l["title"], "url": l["url"]} for l in d["lessons"]]})
    for l in d["lessons"]:
        for i, t in enumerate(l["takeaways"], 1):
            cards.append({"id": f"{l['id']}-k{i}", "domain": d["domain"], "lesson": l["id"],
                          "type": "takeaway", "front": t["q"], "back": t["a"]})
        for i, t in enumerate(l["traps"], 1):
            cards.append({"id": f"{l['id']}-x{i}", "domain": d["domain"], "lesson": l["id"],
                          "type": "trap", "front": t["trap"], "back": t["why"]})

rules = json.loads((RAW / "rules.json").read_text())["rules"]
for dom, items in rules.items():
    for i, (signal, answer) in enumerate(items, 1):
        cards.append({"id": f"r{dom}-{i}", "domain": int(dom), "lesson": f"QR{dom}",
                      "type": "rule", "front": signal, "back": answer})

out = {"version": 1, "source": "https://claudecertificationguide.com/learn",
       "domains": domains, "cards": cards}
(ROOT / "cards.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))

ids = [c["id"] for c in cards]
assert len(ids) == len(set(ids)), "duplicate card ids"
by_type = {}
for c in cards:
    by_type[c["type"]] = by_type.get(c["type"], 0) + 1
print(f"{len(cards)} cards", by_type)
