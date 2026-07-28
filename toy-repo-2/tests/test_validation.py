from stringutils import is_valid_email


def test_valid_email():
    assert is_valid_email("user@example.com") is True


def test_invalid_email_no_at():
    assert is_valid_email("userexample.com") is False


def test_invalid_email_no_domain():
    assert is_valid_email("user@") is False
