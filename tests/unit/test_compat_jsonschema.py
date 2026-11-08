"""T04 spike: jsonschema draft support (config and export schemas, ADR-016)."""

from __future__ import annotations

from importlib.metadata import version

import jsonschema
import pytest
from jsonschema import Draft7Validator, Draft202012Validator, validators

_SCHEMA = {
    "type": "object",
    "required": ["id"],
    "properties": {"id": {"type": "string", "pattern": "^[a-z_]+$"}},
    "additionalProperties": False,
}


@pytest.mark.parametrize(
    ("uri", "cls"),
    [
        ("https://json-schema.org/draft/2020-12/schema", Draft202012Validator),
        ("http://json-schema.org/draft-07/schema#", Draft7Validator),
    ],
)
def test_validator_for_declared_dialect(uri: str, cls: type) -> None:
    assert validators.validator_for({"$schema": uri}) is cls


def test_draft_2020_12_validates_and_reports_errors() -> None:
    Draft202012Validator.check_schema(_SCHEMA)
    v = Draft202012Validator(_SCHEMA)
    assert not list(v.iter_errors({"id": "ok"}))
    assert len(list(v.iter_errors({"id": "BAD", "x": 1}))) == 2


def test_draft_2020_12_specific_keywords() -> None:
    schema = {"type": "array", "prefixItems": [{"type": "string"}], "items": False}
    v = Draft202012Validator(schema)
    assert v.is_valid(["a"])
    assert not v.is_valid(["a", "b"])


def test_draft_07_still_supported() -> None:
    Draft7Validator.check_schema(_SCHEMA)
    assert Draft7Validator(_SCHEMA).is_valid({"id": "ok"})


def test_invalid_schema_rejected() -> None:
    with pytest.raises(jsonschema.SchemaError):
        Draft202012Validator.check_schema({"type": "no-such-type"})


def test_version_recorded() -> None:
    assert version("jsonschema")
