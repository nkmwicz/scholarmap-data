import re

PAGE_RUNNING_HEADER = re.compile(
    r"^(LIVRE |LETTRES ET M[EÉe]MOIRES)",
    re.IGNORECASE,
)

LETTER_BOUNDARY = re.compile(
    r"(^#{1,2} .+|^\*{3}$|^-{3}$)",
    re.MULTILINE,
)

CATCHWORD = re.compile(r"^[A-Z]{1,3}\s*[\d\[\]]*$")


def extract_book_page(header_line: str) -> str | None:
    m = re.search(r"\b(\d+)\b", header_line)
    return m.group(1) if m else None


def clean_title(s: str) -> str:
    return re.sub(r"[*#]+", "", s).strip()


def is_all_caps_title(line: str) -> bool:
    clean = re.sub(r"[#*\s]+", "", line)
    if len(clean) < 6:
        return False
    if CATCHWORD.match(line.strip()):
        return False
    letters = [c for c in line if c.isalpha()]
    if not letters:
        return False
    return sum(1 for c in letters if c.isupper()) / len(letters) > 0.75


def extract_letters(data: dict) -> list[dict]:
    letters: list[dict] = []
    current: dict | None = None

    def start_letter(title: str, pdf_page: int, book_page: str | None) -> None:
        nonlocal current
        if current:
            letters.append(current)
        current = {
            "title": clean_title(title),
            "pdf_pages": [pdf_page],
            "book_pages": [book_page] if book_page else [],
            "markdown": "",
        }

    def append_to_current(text: str, pdf_page: int, book_page: str | None) -> None:
        if current is None:
            return
        current["markdown"] += text
        if pdf_page not in current["pdf_pages"]:
            current["pdf_pages"].append(pdf_page)
        if book_page and book_page not in current["book_pages"]:
            current["book_pages"].append(book_page)

    for page in data["pages"]:
        pdf_page = page["index"]
        md = page["markdown"]

        first_segment = md.split("\n\n")[0]
        if re.match(r"^table", first_segment, re.IGNORECASE):
            break

        segments = md.split("\n\n")
        book_page = extract_book_page(segments[0]) if segments else None
        page_has_running_header = bool(PAGE_RUNNING_HEADER.match(md))

        parts = LETTER_BOUNDARY.split(md)
        i = 0
        while i < len(parts):
            part = parts[i]

            if re.match(r"^#{1,2} ", part):
                is_letter = part.startswith("## ") or page_has_running_header
                if is_letter:
                    start_letter(part, pdf_page, book_page)
                else:
                    append_to_current("\n\n" + part, pdf_page, book_page)
                i += 1

            elif re.match(r"^(\*{3}|-{3})$", part.strip()):
                title_part = parts[i + 1] if i + 1 < len(parts) else ""
                first_line = title_part.lstrip("\n").split("\n")[0].strip()
                if first_line and not PAGE_RUNNING_HEADER.match(first_line):
                    start_letter(first_line, pdf_page, book_page)
                    rest = "\n".join(title_part.lstrip("\n").split("\n")[1:])
                    append_to_current(rest, pdf_page, book_page)
                    i += 2
                    continue
                else:
                    append_to_current("\n\n" + part, pdf_page, book_page)
                    i += 1

            else:
                if page_has_running_header and current is not None:
                    sub_chunks = part.split("\n\n")
                    for j, chunk in enumerate(sub_chunks):
                        first_line = chunk.lstrip("\n").split("\n")[0].strip()
                        if j > 0 and is_all_caps_title(first_line):
                            start_letter(first_line, pdf_page, book_page)
                            rest = "\n".join(chunk.lstrip("\n").split("\n")[1:])
                            append_to_current(rest, pdf_page, book_page)
                        else:
                            append_to_current(
                                ("\n\n" if j > 0 else "") + chunk,
                                pdf_page,
                                book_page,
                            )
                else:
                    append_to_current(part, pdf_page, book_page)
                i += 1

    if current:
        letters.append(current)

    return letters
