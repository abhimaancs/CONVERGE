import re


def slugify(text):
    """Convert a string into a URL-friendly slug.
    e.g. "  Hello   World! " -> "hello-world"
    """
    text = text.strip().lower()
    text = re.sub(r"[^a-z0-9\s-]", "", text)
    # Replace runs of whitespace with a single hyphen
    text = re.sub(r"\s+", "-", text)
    return text


def truncate(text, max_length=20, suffix="..."):
    """Truncate text to max_length, appending suffix if truncated."""
    if len(text) <= max_length:
        return text
    return text[: max_length - len(suffix)] + suffix