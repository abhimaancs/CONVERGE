import re


def slugify(text):
    """Convert a string into a URL-friendly slug.
    e.g. "  Hello   World! " -> "hello-world"
    """
    text = text.strip().lower()
    text = re.sub(r"[^a-z0-9\s-]", "", text)
    # BUG: collapses runs of whitespace into a single space instead of a
    # single hyphen, and never converts remaining spaces to hyphens at all —
    # so "hello   world" becomes "hello world" instead of "hello-world".
    text = re.sub(r"\s+", " ", text)
    return text


def truncate(text, max_length=20, suffix="..."):
    """Truncate text to max_length, appending suffix if truncated."""
    if len(text) <= max_length:
        return text
    return text[: max_length - len(suffix)] + suffix
