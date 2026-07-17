import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from cad_service.dxf_parser import parse_dxf, DxfParseError
from cad_service.block_mapper import map_block
from cad_service.room_classifier import classify_room
from cad_service.ir_models import FurnitureCategory, RoomType
from cad_service.pipeline import run_pipeline

FIXTURE_PATH = os.path.join(os.path.dirname(__file__), "..", "fixtures", "sample_apartment.dxf")


def _load_fixture() -> str:
    with open(FIXTURE_PATH, "r", encoding="utf-8") as f:
        return f.read()


class TestDxfParser(unittest.TestCase):
    def test_parses_entities(self):
        raw = parse_dxf(_load_fixture())
        types = [e.dxftype for e in raw.entities]
        self.assertIn("LWPOLYLINE", types)
        self.assertIn("LINE", types)
        self.assertIn("INSERT", types)
        self.assertIn("TEXT", types)

    def test_insunits_parsed(self):
        raw = parse_dxf(_load_fixture())
        self.assertEqual(raw.insunits, 4)  # millimeters

    def test_empty_input_raises(self):
        with self.assertRaises(DxfParseError):
            parse_dxf("")


class TestBlockMapper(unittest.TestCase):
    def test_exact_bed_variants_resolve_consistently(self):
        for name in ["BED", "BED01", "BED_A"]:
            cat, stage = map_block(name)
            self.assertEqual(cat, FurnitureCategory.BED)
            self.assertEqual(stage, 2)

    def test_king_bed_disambiguation(self):
        cat, _ = map_block("KING_BED")
        self.assertEqual(cat, FurnitureCategory.KING_BED)

    def test_queen_bed_disambiguation(self):
        cat, _ = map_block("DOUBLEBED")
        self.assertEqual(cat, FurnitureCategory.QUEEN_BED)

    def test_unknown_block_falls_back_to_generic(self):
        cat, stage = map_block("XYZ_UNKNOWN_THING_123")
        self.assertEqual(cat, FurnitureCategory.GENERIC)
        self.assertEqual(stage, 3)

    def test_exact_override_takes_precedence(self):
        cat, stage = map_block("CUSTOM01", exact_overrides={"CUSTOM01": FurnitureCategory.SOFA})
        self.assertEqual(cat, FurnitureCategory.SOFA)
        self.assertEqual(stage, 1)


class TestRoomClassifier(unittest.TestCase):
    def test_living_room_synonyms(self):
        for label in ["Living Room", "DRAWING ROOM", "Sitting Area"]:
            rt, conf = classify_room(label)
            self.assertEqual(rt, RoomType.LIVING)
            self.assertGreater(conf, 0)

    def test_bedroom_compound_label(self):
        rt, _ = classify_room("BEDROOM1")
        self.assertEqual(rt, RoomType.BEDROOM)

    def test_unrecognized_label_is_unclassified(self):
        rt, conf = classify_room("Zzyx Chamber")
        self.assertEqual(rt, RoomType.UNCLASSIFIED)
        self.assertEqual(conf, 0.0)

    def test_none_label_is_unclassified(self):
        rt, conf = classify_room(None)
        self.assertEqual(rt, RoomType.UNCLASSIFIED)


class TestPipelineEndToEnd(unittest.TestCase):
    def setUp(self):
        self.result = run_pipeline(_load_fixture(), "sample_apartment.dxf", theme_key="modern")

    def test_two_rooms_found(self):
        self.assertEqual(len(self.result.ir.rooms), 2)

    def test_room_areas_correct(self):
        areas = sorted(r.area_sqm for r in self.result.ir.rooms)
        self.assertAlmostEqual(areas[0], 20.0, places=1)
        self.assertAlmostEqual(areas[1], 20.0, places=1)

    def test_room_types_classified(self):
        types = {r.room_type for r in self.result.ir.rooms}
        self.assertEqual(types, {RoomType.LIVING, RoomType.BEDROOM})

    def test_furniture_extracted_and_openings_excluded(self):
        # 3 furniture INSERTs (SOFA, DINING_TABLE, QUEEN_BED) — door/window
        # INSERTs must NOT be counted as furniture.
        self.assertEqual(len(self.result.ir.furniture), 3)
        categories = {f.category for f in self.result.ir.furniture}
        self.assertEqual(categories, {FurnitureCategory.SOFA, FurnitureCategory.DINING_TABLE,
                                       FurnitureCategory.QUEEN_BED})

    def test_openings_extracted(self):
        self.assertEqual(len(self.result.ir.openings), 2)

    def test_walls_extracted(self):
        self.assertEqual(len(self.result.ir.walls), 2)  # perimeter + partition

    def test_svg_is_well_formed_xml(self):
        import xml.etree.ElementTree as ET
        root = ET.fromstring(self.result.svg)  # raises if malformed
        self.assertTrue(root.tag.endswith("svg"))

    def test_room_detail_shape_matches_nextjs_contract(self):
        # Mirrors types/index.ts RoomDetail / RoomBoundingBox exactly:
        # name, sizeEstimateSqm, boundingBox {x,y,width,height} normalized 0-1.
        for room in self.result.rooms:
            self.assertIn("name", room)
            self.assertIn("sizeEstimateSqm", room)
            bbox = room["boundingBox"]
            for key in ("x", "y", "width", "height"):
                self.assertIn(key, bbox)
                self.assertGreaterEqual(bbox[key], 0.0)
                self.assertLessEqual(bbox[key], 1.0)

    def test_result_is_json_serializable(self):
        json.dumps(self.result.ir.to_dict(), default=str)
        json.dumps(self.result.rooms)

    def test_unknown_theme_falls_back_to_modern(self):
        result = run_pipeline(_load_fixture(), "sample_apartment.dxf", theme_key="totally_made_up")
        self.assertEqual(result.theme_key, "modern")


class TestNoRoomBoundaryFallback(unittest.TestCase):
    def test_falls_back_to_whole_plan_room_without_inventing_subdivisions(self):
        # A minimal DXF with only a wall, no A-AREA boundaries at all.
        dxf = (
            "0\nSECTION\n2\nENTITIES\n"
            "0\nLINE\n5\n1\n8\nA-WALL\n10\n0\n20\n0\n11\n1000\n21\n0\n"
            "0\nENDSEC\n0\nEOF\n"
        )
        result = run_pipeline(dxf, "no_rooms.dxf")
        self.assertEqual(len(result.ir.rooms), 1)
        self.assertTrue(any(w.code == "no_room_boundaries_found" for w in result.ir.warnings))


if __name__ == "__main__":
    unittest.main()
