import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app  # noqa: E402
import uploads  # noqa: E402
from features import locate  # noqa: E402


def make_pdf(pages):
    """A minimal real PDF: one Helvetica text line per list item, one list per page."""
    esc = lambda s: s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    n = len(pages)
    objs = [b"<< /Type /Catalog /Pages 2 0 R >>",
            f"<< /Type /Pages /Kids [{' '.join(f'{4 + 2 * i} 0 R' for i in range(n))}] /Count {n} >>".encode(),
            b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    for i, lines in enumerate(pages):
        ops = ["BT", "/F1 11 Tf", "14 TL", "50 750 Td"] + [f"({esc(ln)}) Tj\nT*" for ln in lines] + ["ET"]
        stream = "\n".join(ops).encode()
        objs.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents {5 + 2 * i} 0 R "
                    f"/Resources << /Font << /F1 3 0 R >> >> >>".encode())
        objs.append(b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream")
    out, offsets = b"%PDF-1.4\n", []
    for i, o in enumerate(objs, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + o + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    out += b"".join(f"{o:010d} 00000 n \n".encode() for o in offsets)
    return out + f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()


HEADER = "ACME MAINTENANCE MANUAL"
MANUAL = [
    [HEADER, "1. INTRODUCTION", "This manual describes the inspection of the hydraulic pump.",
     "Applicability", "This procedure applies to serial numbers 100 to 150.", "Page 1 of 4"],
    [HEADER, "2. Hydraulic pump inspection", "Check the hydraulic pump pressure every 100 flight hours.",
     "Replace the filter if the pressure drops below 2000 psi.", "Page 2 of 4"],
    [HEADER, "3. Torque values", "Tighten the pump mounting bolts to 25 Nm.", "Page 3 of 4"],
    [HEADER, "4. Fuel system", "Inspect the fuel level indicator for leaks.", "Page 4 of 4"],
]


@pytest.fixture()
def client(monkeypatch, tmp_path):
    monkeypatch.setattr(uploads, "DB", tmp_path / "uploads.db")   # never touch the real uploads collection
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    return TestClient(app.app)


def up(client, data, name="manual.pdf"):
    return client.post("/upload", files={"file": (name, data, "application/pdf")})


def ask(client, doc_id, q):
    r = client.post(f"/upload/{doc_id}/ask", json={"query": q})
    assert r.status_code == 200
    return r.json()


def test_heading_detection():
    for h in ("1. INTRODUCTION", "2.3 Inspection procedure", "CHAPTER 5 Fuel system", "TORQUE VALUES", "Appendix A Tables",
              "Applicability", "Probable Cause", "Findings"):
        assert uploads.is_heading(h), h
    for t in ("Check the pump pressure every 100 flight hours.", "12", "Replace the filter, then test.", "ok",
              "Inspection of the pump must be done by certified staff"):
        assert not uploads.is_heading(t), t


def test_upload_builds_page_aware_sections_and_drops_running_headers(client):
    r = up(client, make_pdf(MANUAL))
    assert r.status_code == 200
    d = r.json()
    assert d["pages"] == 4 and d["collection"] == "uploaded" and d["duplicate"] is False and d["record_id"].startswith("UPLOAD-")
    assert "2. Hydraulic pump inspection" in d["sections"]
    assert HEADER not in d["sections"] and not any(s.startswith("Page ") for s in d["sections"])
    chunks = client.get(f"/upload/{d['doc_id']}/text").json()["chunks"]
    by_section = {c["section"]: c for c in chunks}
    assert by_section["2. Hydraulic pump inspection"]["page"] == 2 and by_section["3. Torque values"]["page"] == 3
    assert all(HEADER not in c["text"] for c in chunks)


def test_applicability_is_always_unknown_and_points_at_the_section(client):
    d = up(client, make_pdf(MANUAL)).json()
    assert d["applicability"]["result"] == "UNKNOWN"
    assert any("Applicability" in t and "page 1" in t for t in d["applicability"]["trace"])


def test_reupload_is_idempotent(client):
    a, b = up(client, make_pdf(MANUAL)).json(), up(client, make_pdf(MANUAL), "renamed.pdf").json()
    assert a["doc_id"] == b["doc_id"] and b["duplicate"] is True
    assert len(client.get("/uploads").json()["docs"]) == 1


def test_cited_question_returns_the_exact_page_and_a_locatable_quote(client):
    doc = up(client, make_pdf(MANUAL)).json()["doc_id"]
    r = ask(client, doc, "hydraulic pump pressure")
    assert r["status"] == "answered" and r["mode"] == "extractive" and r["notices"] and r["disclaimer"]
    chunks = {c["chunk_id"]: c for c in client.get(f"/upload/{doc}/text").json()["chunks"]}
    top = r["answer_blocks"][0]["citations"][0]
    assert top["page"] == 2 and top["section"] == "2. Hydraulic pump inspection" and top["source"] == "upload"
    assert locate(chunks[top["chunk_id"]]["text"], top["cited_text"])
    t = ask(client, doc, "torque for the pump mounting bolts")["answer_blocks"][0]["citations"][0]
    assert t["page"] == 3 and "25 Nm" in t["cited_text"]


def test_every_cited_quote_is_found_in_its_chunk(client):
    doc = up(client, make_pdf(MANUAL)).json()["doc_id"]
    chunks = {c["chunk_id"]: c for c in client.get(f"/upload/{doc}/text").json()["chunks"]}
    for q in ("hydraulic pump inspection", "fuel level indicator leaks", "filter pressure psi", "serial numbers applies"):
        for b in ask(client, doc, q)["answer_blocks"]:
            for c in b["citations"]:
                assert locate(chunks[c["chunk_id"]]["text"], c["cited_text"]), c


def test_question_the_document_cannot_answer_is_refused(client):
    doc = up(client, make_pdf(MANUAL)).json()["doc_id"]
    for q in ("who won the world cup", "the", "propeller blade erosion limits"):
        r = ask(client, doc, q)
        assert r["status"] == "refused" and r["answer_blocks"] == [] and r["refusal_reason"], q


def test_bad_uploads_are_rejected(client, monkeypatch):
    assert up(client, b"just some text").status_code == 415
    assert up(client, b"%PDF-1.4 garbage that is not a pdf").status_code == 422
    assert up(client, make_pdf([[]])).status_code == 422                       # no extractable text
    monkeypatch.setattr(uploads, "MAX_BYTES", 100)
    assert up(client, make_pdf(MANUAL)).status_code == 413
    monkeypatch.setattr(uploads, "MAX_BYTES", 20 * 1024 * 1024)
    monkeypatch.setattr(uploads, "MAX_PAGES", 2)
    assert up(client, make_pdf(MANUAL)).status_code == 413
    assert client.get("/uploads").json()["docs"] == []                          # nothing stored on failure


def test_upload_limit_and_delete(client, monkeypatch):
    monkeypatch.setattr(uploads, "MAX_DOCS", 1)
    doc = up(client, make_pdf(MANUAL)).json()["doc_id"]
    assert up(client, make_pdf([["Other manual", "1. Scope", "Different content here."]])).status_code == 409
    assert client.delete(f"/upload/{doc}").status_code == 200
    assert client.get(f"/upload/{doc}/text").status_code == 404
    assert client.post(f"/upload/{doc}/ask", json={"query": "hydraulic pump"}).status_code == 404
    assert client.delete(f"/upload/{doc}").status_code == 404
    assert up(client, make_pdf([["Other manual", "1. Scope", "Different content here."]])).status_code == 200


def test_unknown_upload_is_404(client):
    assert client.get("/upload/999/text").status_code == 404


def test_filename_is_sanitised(client):
    d = up(client, make_pdf(MANUAL), "../../etc/<script>x.pdf").json()
    assert "/" not in d["filename"] and "<" not in d["filename"]


def test_uploads_do_not_touch_the_corpus(client):
    before = (client.get("/corpus").json(), len(app.engine.all_ads()))
    doc = up(client, make_pdf(MANUAL)).json()["doc_id"]
    ask(client, doc, "hydraulic pump pressure")
    assert (client.get("/corpus").json(), len(app.engine.all_ads())) == before
    r = client.post("/ask", json={"query": "fuel starvation engine shutdown", "model": "P.68", "serial": "100"}).json()
    assert r["status"] == "answered" and all(c["record_id"].startswith("NPRM-")
                                              for b in r["answer_blocks"] for c in b["citations"])
