from stringutils import slugify, truncate


def test_slugify_basic():
    assert slugify("Hello World") == "hello-world"


def test_slugify_extra_spaces_and_punctuation():
    assert slugify("  Hello    World!! ") == "hello-world"


def test_slugify_already_slug():
    assert slugify("already-a-slug") == "already-a-slug"


def test_truncate_short_text_unchanged():
    assert truncate("hi", max_length=20) == "hi"


def test_truncate_long_text():
    assert truncate("this is a long sentence", max_length=10) == "this is..."
