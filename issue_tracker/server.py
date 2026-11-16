#!/usr/bin/env python3
"""Local, server-rendered issue tracker. Python 3.10+, no dependencies."""

import argparse
import html
import json
import os
from pathlib import Path
import tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlsplit

CATEGORIES = ("correctness", "efficiency", "code readability/maintainability")
CRITICALITIES = ("critical", "high", "medium", "low")
SORTS = ("id", "criticality")
CRITICALITY_RANK = {name: index for index, name in enumerate(CRITICALITIES)}
DEFAULT_DATA = Path(__file__).with_name("issues.json")


def load_data(path):
    data = json.loads(path.read_text(encoding="utf-8"))
    issues = data["issues"]
    ids = []
    for issue in issues:
        if (type(issue["id"]) is not int or issue["id"] < 1
                or not isinstance(issue["description"], str)
                or not issue["description"].strip()
                or issue["criticality"] not in CRITICALITIES
                or issue["category"] not in CATEGORIES):
            raise ValueError("Invalid issue record")
        ids.append(issue["id"])
    if len(ids) != len(set(ids)):
        raise ValueError("Duplicate issue IDs")
    if type(data["next_id"]) is not int or data["next_id"] <= max(ids, default=0):
        raise ValueError("next_id must exceed all existing issue IDs")
    return data


def add_issue(path, description, criticality, category):
    description = description.strip()
    if not description or len(description) > 10000:
        raise ValueError("Description must contain 1–10,000 characters.")
    if criticality not in CRITICALITIES or category not in CATEGORIES:
        raise ValueError("Choose a valid criticality and category.")
    data = load_data(path)
    issue = dict(id=data["next_id"], description=description,
                 criticality=criticality, category=category)
    data["issues"].append(issue)
    data["next_id"] += 1
    # Replace only after the complete new document has been flushed to disk.
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8",
                                         dir=path.parent, delete=False) as file:
            temporary = file.name
            json.dump(data, file, indent=2, ensure_ascii=False)
            file.write("\n")
            file.flush()
            os.fsync(file.fileno())
        os.replace(temporary, path)
    finally:
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)
    return issue


def sorted_issues(issues, sort):
    if sort == "criticality":
        return sorted(issues, key=lambda issue: (
            CRITICALITY_RANK[issue["criticality"]], -issue["id"]))
    return sorted(issues, key=lambda issue: -issue["id"])


def render(issues, sort="id"):
    escape = html.escape
    if sort not in SORTS:
        sort = "id"
    ordered = sorted_issues(issues, sort)
    rows = "".join(
        f'<tr id="issue-{issue["id"]}" class="criticality-{issue["criticality"]}">'
        f'<td>#{issue["id"]}</td>'
        f'<td class="description">{escape(issue["description"])}</td>'
        f'<td><span class="badge">{escape(issue["criticality"])}</span></td>'
        f'<td>{escape(issue["category"])}</td></tr>'
        for issue in ordered
    ) or '<tr><td colspan="4">No open issues.</td></tr>'
    def options(values, selected=None):
        return "".join(
            f'<option value="{escape(v, quote=True)}"'
            f'{" selected" if v == selected else ""}>{escape(v)}</option>'
            for v in values)
    sort_labels = {"id": "ID (newest first)", "criticality": "Criticality (most severe first)"}
    sort_options = "".join(
        f'<option value="{escape(key, quote=True)}"'
        f'{" selected" if key == sort else ""}>{escape(label)}</option>'
        for key, label in sort_labels.items())
    summary = "Newest first" if sort == "id" else "Most severe first"
    return f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Codebase issue tracker</title>
<style>
body {{font:16px system-ui,sans-serif;max-width:1100px;margin:40px auto;padding:0 20px;color:#17243a;background:#f5f7fb}}
table {{width:100%;border-collapse:collapse;background:white}}
th,td {{padding:14px;text-align:left;border-bottom:1px solid #dce2eb;vertical-align:top}}
.description {{white-space:pre-wrap;overflow-wrap:anywhere}}
.table {{overflow-x:auto}}
.toolbar {{display:flex;align-items:center;gap:12px;margin:16px 0}}
.toolbar label {{margin:0}}
.toolbar select {{background:white}}
.toolbar button {{display:inline-block;margin:0}}
form.record {{background:white;padding:24px;margin-top:30px;border:1px solid #dce2eb;border-radius:8px}}
form.record label {{display:block;margin:16px 0 6px}}
form.record button {{display:block;margin-top:20px}}
textarea {{box-sizing:border-box;width:100%;min-height:120px}}
select,textarea,button {{font:inherit;padding:8px}}
button {{background:#214fc5;color:white;border:0;border-radius:4px;cursor:pointer}}
.badge {{display:inline-block;padding:2px 10px;border-radius:999px;font-weight:650;color:#fff}}
tr.criticality-critical {{background:#fde8e8}}
tr.criticality-critical .badge {{background:#9f1239}}
tr.criticality-high {{background:#ffedd5}}
tr.criticality-high .badge {{background:#c2410c}}
tr.criticality-medium {{background:#fef3c7}}
tr.criticality-medium .badge {{background:#a16207}}
tr.criticality-low {{background:#ede9fe}}
tr.criticality-low .badge {{background:#6d28d9}}
</style></head><body><h1>Codebase issue tracker</h1>
<form class="toolbar" method="get" action="/">
<label for="sort">Sort by</label>
<select id="sort" name="sort" onchange="this.form.submit()">{sort_options}</select>
<noscript><button type="submit">Apply</button></noscript>
</form>
<p>{len(issues)} issue(s) · {summary}</p>
<div class="table"><table><thead><tr><th scope="col">ID</th><th scope="col">Description</th><th scope="col">Criticality</th><th scope="col">Category</th></tr></thead><tbody>{rows}</tbody></table></div>
<form class="record" method="post" action="/issues"><h2>Record an issue</h2>
<label for="description">Description</label><textarea id="description" name="description" required maxlength="10000"></textarea>
<label for="criticality">Criticality</label><select id="criticality" name="criticality">{options(CRITICALITIES)}</select>
<label for="category">Category</label><select id="category" name="category">{options(CATEGORIES)}</select>
<button type="submit">Add issue</button></form></body></html>'''


class Handler(BaseHTTPRequestHandler):
    def respond(self, status, body):
        encoded = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self):
        if urlsplit(self.path).path != "/":
            self.respond(404, "<h1>Not found</h1>")
            return
        query = parse_qs(urlsplit(self.path).query, max_num_fields=4)
        sort = query.get("sort", ["id"])[0]
        if sort not in SORTS:
            sort = "id"
        try:
            self.respond(200, render(load_data(self.server.data_path)["issues"], sort))
        except (OSError, ValueError, KeyError, TypeError):
            self.respond(500, "<h1>Unable to read issue data</h1><p>Check the server's JSON file.</p>")

    def do_POST(self):
        if self.path != "/issues":
            self.respond(404, "<h1>Not found</h1>")
            return
        # Browsers submit a same-origin form without custom scripting.
        if self.headers.get("Origin") not in (None, f'http://{self.headers.get("Host")}'):
            self.respond(403, "<h1>Invalid origin</h1>")
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 131072:
                raise ValueError("Invalid form size.")
            if self.headers.get_content_type() != "application/x-www-form-urlencoded":
                raise ValueError("Expected form data.")
            fields = parse_qs(self.rfile.read(length).decode("utf-8"), max_num_fields=3)
            values = [fields[name][0] for name in ("description", "criticality", "category")]
        except (ValueError, KeyError, UnicodeError) as error:
            self.respond(400, f'<h1>Invalid submission</h1><p>{html.escape(str(error))}</p><a href="/">Back</a>')
            return
        try:
            issue = add_issue(self.server.data_path, *values)
        except ValueError:
            self.respond(400, '<h1>Invalid issue</h1><p>Check the description, criticality and category.</p><a href="/">Back</a>')
            return
        except (OSError, KeyError, TypeError):
            self.respond(500, "<h1>Unable to save issue data</h1>")
            return
        self.send_response(303)
        self.send_header("Location", f'/#issue-{issue["id"]}')
        self.send_header("Content-Length", "0")
        self.end_headers()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    args = parser.parse_args()
    load_data(args.data)  # Fail early instead of overwriting invalid data.
    # One process serializes requests so ID allocation and writes cannot race.
    server = HTTPServer((args.host, args.port), Handler)
    server.data_path = args.data.resolve()
    print(f"Issue tracker: http://{args.host}:{server.server_port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
