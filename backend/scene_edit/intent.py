"""What a typed scene command asks for (MoveIntent). The LLM (Pydantic AI, model from env LLM_MODEL) only fills
this schema; it never produces coordinates. Without a model/key, or on any LLM error, rule_parse() fills the
same schema from a few fixed phrasings. Geometry is decided later by backend/scene_edit/command.py."""

from __future__ import annotations

import logging
import re
from typing import Literal

from pydantic import BaseModel, Field

log = logging.getLogger(__name__)

Action = Literal["translate", "rotate", "place_near", "against_wall", "clear_route", "remove", "not_a_move"]
Direction = Literal["left", "right", "forward", "back", "+x", "-x", "+z", "-z"]


class Landmark(BaseModel):
    kind: Literal["entrance", "asset"] = Field(description="entrance = the room's door/entrance; asset = a tagged "
                                                           "plant asset such as P-002, M-004, CV-001")
    ref: str | None = Field(None, description="asset tag for kind=asset, e.g. 'P-002'")


class MoveIntent(BaseModel):
    action: Action = Field(description="translate = move by a distance in a direction; rotate = turn in place; "
                                       "place_near = put next to a landmark; against_wall = push to the nearest wall; "
                                       "clear_route = get it out of the walking route to an asset; "
                                       "remove = take it out of the scene entirely (delete it); "
                                       "not_a_move = anything else")
    object_ref: str | None = Field(None, description="the user's words for the object to move")
    movable_id: str | None = Field(None, description="MOV-xx if the object is one of the listed movables, else null")
    movable_options: list[str] = Field(default_factory=list,
                                       description="several MOV ids when the words fit more than one movable")
    fixed_subject: str | None = Field(None, description="name of the object if the user asks to move something that "
                                                        "is NOT in the movables list (pump, valve, P-002, pipe, ...)")
    distance_m: float | None = Field(None, description="metres, for translate")
    direction: Direction | None = Field(None, description="left/right/forward/back as the user sees the scene "
                                                          "(back = towards the viewer); +x/-x/+z/-z only if said")
    yaw_deg: float | None = Field(None, description="rotate: degrees, positive = counter-clockwise seen from above "
                                                    "(clockwise = negative)")
    landmark: Landmark | None = None
    asset_ref: str | None = Field(None, description="clear_route: tag of the asset whose route to clear, e.g. "
                                                    "'P-002'; null = the currently selected asset")
    note: str | None = Field(None, description="not_a_move: short reason")


# ---------------------------------------------------------------- rule-based parser (no key / LLM error)
ALIASES: list[tuple[str, list[str]]] = [  # most specific first
    (r"office chair|desk chair|swivel chair|black chair", ["MOV-01"]),
    (r"green chair", ["MOV-02"]),
    (r"pallet (?:truck|jack)", ["MOV-03"]),
    (r"vacuum|hoover|wet[/ -]?dry", ["MOV-04"]),
    (r"stool", ["MOV-05"]),
    (r"hand ?truck|sack truck|dolly", ["MOV-06"]),
    (r"step ?ladder|stepladder|aluminium ladder|aluminum ladder", ["MOV-08"]),
    (r"ladder", ["MOV-07"]),
    (r"cardboard box|carton|\bbox\b", ["MOV-09"]),
    (r"washing machine|washer|front.?loader|laundry machine", ["MOV-10"]),
    (r"washing machine|washer|laundry machine|\bwasher-?dryer\b", ["MOV-10"]),
    (r"\bchairs?\b", ["MOV-01", "MOV-02"]),
    (r"trolley|\bcart\b", ["MOV-03", "MOV-06"]),
]
FIXED_NOUNS = (r"\b(pumps?|valves?|motors?|pipes?|pipework|piping|tanks?|cabinets?|transmitters?|sensors?|gauges?"
               r"|shelf|shelves|shelving|walls?|doors?|floor|ceiling|boiler|columns?|poles?|beams?)\b")
TAG = r"\b(?:p|m|cv|pt|vs)-\d{3}\b"
ENTRANCE = r"door(?:way)?|entrance|entry|exit|way in"
REMOVE = (r"\b(remove|delete|erase|get rid of|throw (?:away|out)|discard|dispose of)\b"
          r"|\b(?:out of|from|off) (?:the )?(?:scene|room|model|twin|digital twin|map|plant)\b")
NEAR = r"next to|near(?:by)?|beside|close to|by|in front of|towards?|at"
WORDS = {"one": 1, "two": 2, "three": 3, "half a": 0.5, "a half": 0.5, "a": 1}


def _num(s: str) -> float | None:
    try:
        return float(s)
    except ValueError:
        return WORDS.get(s)


def match_movable(text: str) -> list[str]:
    t = text.lower()
    if m := re.search(r"\bmov-?(\d{1,2})\b", t):
        return [f"MOV-{int(m.group(1)):02d}"]
    for pat, ids in ALIASES:
        if re.search(pat, t):
            return ids
    return []


def match_fixed(text: str) -> str | None:
    t = text.lower()
    m = re.search(TAG, t) or re.search(FIXED_NOUNS, t)
    return m.group(0).upper() if m and re.fullmatch(TAG, m.group(0)) else (m.group(0) if m else None)


def rule_parse(text: str) -> MoveIntent:
    t = " ".join(text.lower().replace("’", "'").split())
    subject = t
    kw: dict = {}

    if re.search(REMOVE, t):
        action = "remove"
        subject = re.sub(REMOVE, " ", t)
    elif re.search(r"\b(clear|free|unblock|open up)\b.*\b(walkway|route|path|way|aisle)\b", t) or \
            re.search(r"out of (?:the )?(?:technician'?s? |avatar'?s? |robot'?s? )?(?:route|way|path|walkway)", t):
        action = "clear_route"
        tag = re.search(TAG, t)
        kw["asset_ref"] = tag.group(0).upper() if tag else None
        subject = re.sub(TAG, " ", t)
        subject = re.sub(r"\b(clear|free|unblock|open up)\b.*\b(walkway|route|path|aisle)\b( to)?", " ", subject)
    elif re.search(r"\b(rotate|turn|spin|swivel|twist)\b", t):
        action = "rotate"
        m = re.search(r"(?<![\w-])(-?\d+(?:\.\d+)?)\s*(?:°|deg\w*)?", t)
        yaw = float(m.group(1)) if m else (180.0 if "around" in t else 90.0)
        if re.search(r"(?<!counter)(?<!counter-)(?<!anti)(?<!anti-)clockwise|\bcw\b|to the right", t):
            yaw = -abs(yaw)
        kw["yaw_deg"] = yaw
    elif re.search(r"\b(against|to|by|next to|near|up to) (?:the )?(?:nearest )?wall\b", t):
        action = "against_wall"
        subject = re.sub(r"\b(against|to|by|next to|near|up to) (?:the )?(?:nearest )?wall\b", " ", t)
    elif (m := re.search(rf"\b(?:{NEAR})\s+(?:the\s+)?(?:pump\s+|motor\s+|valve\s+)?({ENTRANCE}|{TAG})\b", t)):
        action = "place_near"
        ref = m.group(1)
        kw["landmark"] = Landmark(kind="asset", ref=ref.upper()) if re.fullmatch(TAG, ref) else Landmark(kind="entrance")
        subject = t[: m.start()] + " " + t[m.end():]
    elif (m := re.search(r"(\d+(?:\.\d+)?|one|two|three|half a|a half|a)\s*(cm|centimet\w*|m|metres?|meters?)\b", t)) \
            or re.search(r"\b(left|right|forward|forwards|back|backwards|closer|away|towards me)\b", t):
        action = "translate"
        dist = 0.3  # "a bit to the left"
        if m:
            dist = (_num(m.group(1)) or 1.0) * (0.01 if m.group(2).startswith("c") else 1.0)
        d = re.search(r"\b(left|right|forwards?|backwards?|back|closer|towards me|away|[+-][xz])(?=\W|$)", t)
        word = d.group(1) if d else None
        direction = {"forwards": "forward", "backwards": "back", "closer": "back", "towards me": "back",
                     "away": "forward"}.get(word, word)
        if direction is None:
            return MoveIntent(action="not_a_move", note="say which way (left, right, forward, back)",
                              object_ref=t, **_subject(t))
        kw.update(distance_m=round(dist, 3), direction=direction)
    else:
        return MoveIntent(action="not_a_move", object_ref=t, **_subject(t),
                          note="try e.g. 'move the vacuum 1 m to the left', 'rotate the stool 90°', "
                               "'put the office chair next to the door', 'clear the walkway to P-002'")
    return MoveIntent(action=action, object_ref=subject.strip() or None, **_subject(subject), **kw)


def _subject(text: str) -> dict:
    ids = match_movable(text)
    if len(ids) == 1:
        return {"movable_id": ids[0]}
    if ids:
        return {"movable_options": ids}
    return {"fixed_subject": match_fixed(text)}


# ---------------------------------------------------------------- LLM intent
INSTRUCTIONS = """You turn a field technician's command about moving objects in a scanned industrial room into a
MoveIntent. You never output coordinates: geometry is computed and safety-checked by other code.
Only the listed movables can move. If the user names anything else (a pump, valve, motor, pipe, wall, door, or an
asset tag such as P-002 as the thing to move), set fixed_subject to it and leave movable_id null.
Asset tags (P-, M-, CV-, PT-, VS-) can be landmarks ('next to P-002') or route targets ('clear the walkway to P-002').
'door', 'entrance', 'exit' -> landmark kind=entrance. 'against the wall' -> action against_wall.
Directions are as the user sees the screen: left, right, forward (away from the viewer), back (towards the viewer).
'a bit' = 0.3 m. Rotation: positive yaw = counter-clockwise from above; 'clockwise' = negative; no angle = 90.
If the words fit several movables (e.g. 'chair'), list them in movable_options and leave movable_id null.
'Remove/delete X', 'move X from/out of the scene', 'get rid of X' -> action remove (take it out of the scene).
Anything that is not a request to move one object -> action not_a_move with a short note."""


def llm_intent(model: str, text: str, movables: list[dict], tags: list[str]) -> MoveIntent:
    from pydantic_ai import Agent

    agent = Agent(model, output_type=MoveIntent, instructions=INSTRUCTIONS, retries=2)
    listing = "\n".join(f"- {m['object_id']}: {m['label']}" for m in movables)
    prompt = f"Movables:\n{listing}\nAsset tags in the room: {', '.join(tags)}\n\nCommand: {text}"
    return agent.run_sync(prompt).output
