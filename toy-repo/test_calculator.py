from calculator import add, subtract, divide, average


def test_add():
    assert add(2, 3) == 5


def test_subtract():
    assert subtract(5, 3) == 2


def test_divide():
    assert divide(7, 2) == 3.5


def test_divide_exact():
    assert divide(10, 2) == 5.0


def test_average():
    assert average([1, 2, 3, 4]) == 2.5
