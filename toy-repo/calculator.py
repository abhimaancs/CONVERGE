"""A tiny calculator module — has one intentional bug for the agent to find and fix."""


def add(a, b):
    return a + b


def subtract(a, b):
    return a - b


def divide(a, b):
    # FIX: use true division instead of integer division
    return a / b


def average(numbers):
    if not numbers:
        raise ValueError("cannot average an empty list")
    return sum(numbers) / len(numbers)