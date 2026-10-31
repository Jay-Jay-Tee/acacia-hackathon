"""P4 feature endpoints. Mounted in app.py with one line: app.include_router(features.router)"""
import sqlite3

from fastapi import APIRouter, HTTPException

import engine

router = APIRouter()


def _chunks(ad_id):
    # Own read-only connection: engine keeps its connection private, and the chunks table is the contract.
    con = sqlite3.connect(f"file:{engine.DB}?mode=ro", uri=True)
    try:
        return con.execute("SELECT id, section, page, text FROM chunks WHERE ad_id = ? ORDER BY id",
                           (ad_id,)).fetchall()
    finally:
        con.close()


@router.get("/ad/{ad_id}/text")
def ad_text(ad_id: int):
    """Full text of one document as ordered chunks, so the UI can scroll to a citation's `chunk_id`.

    `page` is the Federal Register page where the chunk starts; the client draws a page marker whenever it
    changes. `anchors` lists one entry per section, in reading order, for navigation.
    """
    if ad_id not in engine.all_ads():
        raise HTTPException(404, "unknown ad_id")
    card = engine.ad_card(ad_id)
    chunks = [{"chunk_id": cid, "section": section, "page": page, "anchor": f"chunk-{cid}", "text": text}
              for cid, section, page, text in _chunks(ad_id)]
    anchors, last = [], None
    for c in chunks:
        if c["section"] != last:
            anchors.append({"section": c["section"], "page": c["page"], "chunk_id": c["chunk_id"],
                            "anchor": c["anchor"]})
            last = c["section"]
    return {"ad_id": ad_id, "record_id": card["record_id"], "docket": card["docket"], "subject": card["subject"],
            "status": card["status"], "status_label": card["status_label"], "pages": card["pages"],
            "citation": card["citation"], "url": card["url"], "chunks": chunks, "anchors": anchors}
