"""A tiny calculator module — has one intentional bug for the agent to find and fix."""


def add(a, b):
    return a + b


def subtract(a, b):
    return a - b


def divide(a, b):
    # BUG: uses integer division instead of true division,
    # so divide(7, 2) returns 3 instead of 3.5
    return a // b


def average(numbers):
    if not numbers:
        raise ValueError("cannot average an empty list")
    return sum(numbers) / len(numbers)
