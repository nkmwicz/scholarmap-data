-- Individual OCR lines removed by the user in the Boundary Editor
CREATE TABLE excluded_lines (
    book_id     UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    page_index  INT NOT NULL,
    line_index  INT NOT NULL,
    PRIMARY KEY (book_id, page_index, line_index)
);

CREATE INDEX excluded_lines_book_idx ON excluded_lines(book_id);
