"""공유 미리보기(썸네일)용 메타데이터를 채우고, 대회마다 전용 페이지를 만든다.

링크 미리보기(카카오톡·디스코드 등)는 JS를 실행하지 않으므로 메타 태그가 HTML에 고정돼 있어야 한다.
event.html?e=<id> 는 정적 파일 하나라 대회별로 다르게 할 수 없어서, <id>/index.html 을 따로 만든다.

    python tools/build_pages.py

events/index.json 의 site.url (사이트 주소)이 필요하다. 대회를 추가하거나 이름·설명·로고를 바꾸면 다시 실행한다.
"""

from __future__ import annotations

import html
import json
import re
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EVENTS_DIR = ROOT / "events"
TEMPLATE = ROOT / "event.html"
INDEX_PAGE = ROOT / "index.html"
DEFAULT_IMAGE = "assets/site-logo.png"
SITE_ICON = "assets/site-logo.svg"
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
META_RE = re.compile(r"  <!-- meta:start.*?-->\n.*?  <!-- meta:end -->\n", re.S)
META_START = "  <!-- meta:start (tools/build_pages.py가 채움) -->\n"
META_END = "  <!-- meta:end -->\n"
PREVIEW_FORMATS = (".png", ".jpg", ".jpeg", ".gif", ".webp")
# 대회 폴더 안의 데이터 파일과 겹치지 않게 페이지는 사이트 루트의 <id>/ 에 둔다.
RESERVED_IDS = {"assets", "css", "js", "events", "tools"}


def write_text(path: Path, text: str) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def png_size(path: Path) -> tuple[int, int] | None:
    """PNG 헤더에서 크기를 읽는다 (미리보기 레이아웃 계산용, 없으면 생략)."""
    with path.open("rb") as f:
        head = f.read(24)
    if head[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    return struct.unpack(">II", head[16:24])


def preview_image(logo: str | None) -> str:
    """미리보기에 쓸 이미지. SVG는 대부분의 서비스가 못 읽어서 기본 PNG로 대신한다."""
    if logo and Path(logo).suffix.lower() in PREVIEW_FORMATS and (ROOT / logo).is_file():
        return logo
    if logo:
        print(f"  경고: 로고 {logo}는 미리보기에 쓸 수 없어 {DEFAULT_IMAGE}를 씁니다 (png/jpg 권장).")
    return DEFAULT_IMAGE


def meta_block(*, site_url: str, page_path: str, title: str, description: str, image: str, site_name: str,
               color: str | None) -> str:
    esc = lambda value: html.escape(value, quote=True)  # noqa: E731
    image_url = site_url + image
    tags = [
        f'<meta name="description" content="{esc(description)}">',
        f'<meta property="og:type" content="website">',
        f'<meta property="og:site_name" content="{esc(site_name)}">',
        f'<meta property="og:title" content="{esc(title)}">',
        f'<meta property="og:description" content="{esc(description)}">',
        f'<meta property="og:url" content="{esc(site_url + page_path)}">',
        f'<meta property="og:image" content="{esc(image_url)}">',
        f'<meta property="og:locale" content="ko_KR">',
        f'<meta name="twitter:card" content="summary">',
    ]
    if color:
        tags.append(f'<meta name="theme-color" content="{esc(color)}">')
    size = png_size(ROOT / image) if image.lower().endswith(".png") else None
    if size:
        tags.insert(7, f'<meta property="og:image:width" content="{size[0]}">')
        tags.insert(8, f'<meta property="og:image:height" content="{size[1]}">')
    return META_START + "".join(f"  {tag}\n" for tag in tags) + META_END


def replace_meta(page: str, block: str, source: Path) -> str:
    if not META_RE.search(page):
        sys.exit(f"{source.name}에 <!-- meta:start --> ~ <!-- meta:end --> 표시가 없습니다.")
    return META_RE.sub(lambda _: block, page, count=1)


def main() -> None:
    index = load_json(EVENTS_DIR / "index.json")
    site = index.get("site") or {}
    site_url = (site.get("url") or "").strip()
    if not site_url.startswith("https://"):
        sys.exit("events/index.json 의 site.url 에 사이트 주소(https://…/)를 넣어 주세요.")
    site_url = site_url.rstrip("/") + "/"
    site_name = site.get("name") or "대회 순위"
    theme_color = (index.get("theme") or {}).get("brand")

    # 대회 목록 페이지
    page = replace_meta(INDEX_PAGE.read_text(encoding="utf-8"), meta_block(
        site_url=site_url, page_path="", title=site_name,
        description=site.get("description") or "", image=DEFAULT_IMAGE, site_name=site_name, color=theme_color,
    ), INDEX_PAGE)
    write_text(INDEX_PAGE, page)
    print("index.html")

    template = TEMPLATE.read_text(encoding="utf-8")
    for entry in index.get("events", []):
        event_id = entry.get("id", "")
        if not SLUG_RE.match(event_id) or event_id in RESERVED_IDS:
            print(f"  건너뜀: 잘못된 id {event_id!r}")
            continue
        event = load_json(EVENTS_DIR / event_id / "event.json")
        title = event.get("name") or entry.get("name") or event_id
        description = event.get("description") or entry.get("period") or ""
        image = preview_image(event.get("logo"))
        block = meta_block(
            site_url=site_url, page_path=f"{event_id}/", title=title, description=description,
            image=image, site_name=site_name,
            color=(event.get("theme") or {}).get("brand") or theme_color,
        )

        page = replace_meta(template, block, TEMPLATE)
        # 탭 아이콘·헤더 로고도 처음부터 대회 로고로 (사이트 로고가 잠깐 보이지 않게)
        logo = html.escape(event.get("logo") or SITE_ICON, quote=True)
        page = page.replace(f'<link rel="icon" href="{SITE_ICON}" type="image/svg+xml">', f'<link rel="icon" href="{logo}">', 1)
        page = page.replace(f'<link rel="apple-touch-icon" href="{DEFAULT_IMAGE}">', f'<link rel="apple-touch-icon" href="{html.escape(image, quote=True)}">', 1)
        page = page.replace(f'<img id="logo" class="logo" src="{SITE_ICON}"', f'<img id="logo" class="logo" src="{logo}"', 1)
        # 한 단계 아래 폴더라서 상대 경로(css/js/events)를 사이트 루트 기준으로 맞춘다.
        page = page.replace('<meta charset="utf-8">\n', '<meta charset="utf-8">\n  <base href="../">\n', 1)
        page = page.replace('<html lang="ko">', f'<html lang="ko" data-event="{event_id}">', 1)
        page = re.sub(r"<title>.*?</title>", f"<title>{html.escape(title)}</title>", page, count=1)
        # doctype 앞 주석은 오래된 브라우저를 호환 모드로 만들 수 있어 <head> 안에 둔다.
        page = page.replace("<head>\n", "<head>\n  <!-- tools/build_pages.py로 생성한 파일입니다. event.html을 고친 뒤 다시 실행하세요. -->\n", 1)

        out = ROOT / event_id / "index.html"
        out.parent.mkdir(exist_ok=True)
        write_text(out, page)
        print(f"{event_id}/index.html  ({title})")


if __name__ == "__main__":
    main()
