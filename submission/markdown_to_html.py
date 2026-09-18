from html import escape
from pathlib import Path

source = Path(__file__).with_name("solution-pack.md")
output = Path("/tmp/solution-pack.html")
lines = source.read_text(encoding="utf-8").splitlines()
html = [
    '<!doctype html><meta charset="utf-8">',
    '<style>@page{size:A4;margin:16mm 15mm}body{font-family:"Arial Unicode MS","Heiti SC","PingFang SC",sans-serif;color:#243447;line-height:1.55;font-size:10.5pt}h1{font-size:25pt;text-align:center;color:#17324d;border-bottom:2px solid #3b82b6;padding-bottom:10px;margin:0 0 22px}h2{font-size:17pt;color:#17324d;margin-top:24px;border-left:4px solid #1b6b73;padding-left:9px}h3{font-size:13pt;color:#1b6b73;margin-top:18px}p{margin:7px 0}li{margin:4px 0}table{width:100%;border-collapse:collapse;margin:10px 0 16px;page-break-inside:avoid}th,td{border:1px solid #cbd5e1;padding:6px 7px;vertical-align:top}th{background:#dceff0;text-align:left}pre{padding:10px;background:#f1f5f9;white-space:pre-wrap}footer{position:fixed;bottom:-8mm;left:0;right:0;text-align:center;color:#64748b;font-size:8pt}</style>',
    '<footer>履约异常调查与处置 Agent · 2026-09-07</footer>',
]
i = 0
while i < len(lines):
    line = lines[i]
    if not line.strip():
        i += 1
        continue
    if line.startswith("|"):
        rows = []
        while i < len(lines) and lines[i].startswith("|"):
            row = [x.strip() for x in lines[i].strip().strip("|").split("|")]
            if not all(set(x) <= set("-: ") for x in row):
                rows.append(row)
            i += 1
        html.append("<table><thead><tr>" + "".join("<th>" + escape(x) + "</th>" for x in rows[0]) + "</tr></thead><tbody>")
        for row in rows[1:]:
            html.append("<tr>" + "".join("<td>" + escape(x) + "</td>" for x in row) + "</tr>")
        html.append("</tbody></table>")
        continue
    if line.startswith("```"):
        code = []
        i += 1
        while i < len(lines) and not lines[i].startswith("```"):
            code.append(lines[i])
            i += 1
        i += 1
        html.append("<pre>" + escape("\n".join(code)) + "</pre>")
        continue
    if line.startswith("# "):
        html.append("<h1>" + escape(line[2:].strip()) + "</h1>")
    elif line.startswith("## "):
        html.append("<h2>" + escape(line[3:].strip()) + "</h2>")
    elif line.startswith("### "):
        html.append("<h3>" + escape(line[4:].strip()) + "</h3>")
    elif line.startswith("- "):
        html.append("<li>" + escape(line[2:].strip()) + "</li>")
    elif len(line) > 3 and line[0].isdigit() and line[1:3] == ". ":
        html.append("<li>" + escape(line[3:].strip()) + "</li>")
    else:
        segments = escape(line).split("**")
        text = "".join(("<strong>" + part + "</strong>" if j % 2 else part) for j, part in enumerate(segments))
        html.append("<p>" + text + "</p>")
    i += 1
output.write_text("".join(html), encoding="utf-8")
print(output)
