import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import engine  # noqa: E402
import rules  # noqa: E402


def verdict(text, model, serial=None, models=None):
    ad = {"docket": "T-1", "models": models or [model], "applicability_text": text, "summary": ""}
    return engine.check_applicability(ad, model, serial)["result"]


def test_serial_list():
    t = "This AD applies to Piaggio Model P-180 airplanes, manufacturer serial numbers 1032, 1036, 1037 and 1112."
    assert verdict(t, "P-180", "1037") == "APPLIES"
    assert verdict(t, "P-180", "1038") == "DOES_NOT_APPLY"


def test_range_with_excepted_serials():
    t = "This AD applies to Model Cabri G2 helicopters having serial number (S/N) 1003 to 1389, except S/N 1383 and 1388."
    assert verdict(t, "Cabri G2", "1200") == "APPLIES"
    assert verdict(t, "Cabri G2", "1383") == "DOES_NOT_APPLY"
    assert verdict(t, "Cabri G2", "1500") == "DOES_NOT_APPLY"


def test_up_to_and_including():
    t = "This AD applies to Model EC135P2 helicopters, serial numbers up to and including 1999."
    assert verdict(t, "EC135P2", "1999") == "APPLIES"
    assert verdict(t, "EC135P2", "2000") == "DOES_NOT_APPLY"


def test_dashed_serials():
    t = "This AD applies to Piper Model PA-34-200 airplanes, serial numbers 34-7250001 through 34-7450220."
    assert verdict(t, "PA-34-200", "34-7300100") == "APPLIES"
    assert verdict(t, "PA-34-200", "34-8000001") == "DOES_NOT_APPLY"


def test_serial_format_mismatch_is_unknown_not_excluded():
    t = "This AD applies to Model X-1 airplanes, serial numbers S-1000 through S-1500."
    assert verdict(t, "X-1", "1200") == "UNKNOWN"


def test_per_model_paragraphs():
    t = ("This AD applies to Bombardier, Inc., airplanes, identified in paragraphs (c)(1) through (3) of this AD. "
         "(1) Model CL-600-1A11 (600) airplanes, serial numbers 1001 through 1085 inclusive. "
         "(2) Model CL-600-2A12 (601) airplanes, serial numbers 3001 through 3066 inclusive. "
         "(3) Model CL-600-2B16 airplanes, serial numbers 5001 through 5194 inclusive, and 6050 through 6190 inclusive.")
    models = ["CL-600-1A11", "CL-600-2A12", "CL-600-2B16"]
    assert verdict(t, "CL-600-2A12", "3050", models) == "APPLIES"
    assert verdict(t, "CL-600-2A12", "1050", models) == "DOES_NOT_APPLY"
    assert verdict(t, "CL-600-2B16", "6000", models) == "DOES_NOT_APPLY"  # gap between ranges
    assert rules.parse_models(t) == models


def test_per_model_paragraph_without_model_word():
    t = ("This AD applies to GE Model CF34-1A and CF34-3A engines: (1) CF34-1A engines with ESN 350103 through 350525. "
         "(2) CF34-3A1 engines with ESN 807001 through 807661.")
    assert verdict(t, "CF34-3A1", "807500", ["CF34-1A", "CF34-3A1"]) == "APPLIES"
    assert verdict(t, "CF34-3A1", "350200", ["CF34-1A", "CF34-3A1"]) == "DOES_NOT_APPLY"


def test_all_serials_and_missing_serial():
    assert verdict("This AD applies to Model 690C airplanes, all serial numbers, certificated in any category.", "690C") == "APPLIES"
    t = "This AD applies to Model P.68 airplanes, serial numbers 1 through 182."
    assert verdict(t, "P.68") == "UNKNOWN"  # serial needed


def test_external_table_and_config_conditions_are_unknown():
    assert verdict("This AD applies to Model PA-28 airplanes with a model and serial number shown in Table 1 "
                   "to paragraph (c) of this AD.", "PA-28", "1") == "UNKNOWN"
    assert verdict("This AD applies to all Model AW139 helicopters, certificated in any category, with FAA "
                   "Supplemental Type Certificate (STC) SR04384NY installed.", "AW139", "31001") == "UNKNOWN"
    assert verdict("This AD applies to all Model A330-201 airplanes; all manufacturer serial numbers, except for those "
                   "airplanes that have had Airbus Modification 52980 incorporated in production.", "A330-201", "1") == "UNKNOWN"
