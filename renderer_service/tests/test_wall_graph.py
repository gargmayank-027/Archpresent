"""
tests/test_wall_graph.py

Unit tests for app/services/wall_graph.py — the standalone geometry
algorithm, independent of DXF parsing. Covers the synthetic cases built
up while developing this (two rooms sharing a wall, a single room, an
L-shape, a 2x2 grid with T-junctions and a cross junction, a dangling
stub, coordinate noise, a T-junction with a real gap, two disconnected
buildings) plus the sanity-check logic that protects against presenting
a wrong-but-confident room split on a poorly-connected wall network.
"""

from __future__ import annotations

from app.services.wall_graph import derive_room_polygons, rooms_pass_sanity_check, _polygon_area_signed


def _area_m2(room: list[tuple[float, float]]) -> float:
    return abs(_polygon_area_signed(room)) / 1_000_000


def test_two_rooms_sharing_a_wall():
    segments = [
        ((0, 0), (8000, 0)), ((8000, 0), (8000, 5000)), ((8000, 5000), (0, 5000)), ((0, 5000), (0, 0)),
        ((4000, 0), (4000, 5000)),
    ]
    rooms = derive_room_polygons(segments)
    assert len(rooms) == 2
    areas = sorted(round(_area_m2(r), 2) for r in rooms)
    assert areas == [20.0, 20.0]


def test_single_rectangle_no_partition():
    segments = [((0, 0), (6000, 0)), ((6000, 0), (6000, 4000)), ((6000, 4000), (0, 4000)), ((0, 4000), (0, 0))]
    rooms = derive_room_polygons(segments)
    assert len(rooms) == 1
    assert abs(_area_m2(rooms[0]) - 24.0) < 0.01


def test_l_shaped_room():
    segments = [
        ((0, 0), (6000, 0)), ((6000, 0), (6000, 3000)), ((6000, 3000), (3000, 3000)),
        ((3000, 3000), (3000, 6000)), ((3000, 6000), (0, 6000)), ((0, 6000), (0, 0)),
    ]
    rooms = derive_room_polygons(segments)
    assert len(rooms) == 1
    assert abs(_area_m2(rooms[0]) - 27.0) < 0.01


def test_2x2_grid_with_cross_junction():
    segments = [
        ((0, 0), (8000, 0)), ((8000, 0), (8000, 6000)), ((8000, 6000), (0, 6000)), ((0, 6000), (0, 0)),
        ((4000, 0), (4000, 6000)), ((0, 3000), (8000, 3000)),
    ]
    rooms = derive_room_polygons(segments)
    assert len(rooms) == 4
    areas = [_area_m2(r) for r in rooms]
    assert all(abs(a - 12.0) < 0.01 for a in areas)


def test_dangling_stub_does_not_create_a_phantom_room():
    segments = [
        ((0, 0), (6000, 0)), ((6000, 0), (6000, 4000)), ((6000, 4000), (0, 4000)), ((0, 4000), (0, 0)),
        ((3000, 4000), (3000, 5500)),  # sticks out, closes nowhere
    ]
    rooms = derive_room_polygons(segments)
    assert len(rooms) == 1


def test_small_coordinate_noise_at_corners_still_snaps():
    segments = [
        ((0, 0), (6000, 3)), ((6000, 0), (6002, 4000)),
        ((6000, 4000), (0, 4001)), ((0, 4000), (1, 0)),
    ]
    rooms = derive_room_polygons(segments, snap_tolerance=50.0)
    assert len(rooms) == 1


def test_t_junction_with_a_real_gap_still_closes():
    """A partition wall's endpoint 8mm short of touching the perimeter —
    the pattern that turned out to matter for real-world files."""
    segments = [
        ((0, 0), (8000, 0)), ((8000, 0), (8000, 5000)), ((8000, 5000), (0, 5000)), ((0, 5000), (0, 0)),
        ((4000, 0), (4000, 4992)),
    ]
    rooms = derive_room_polygons(segments, snap_tolerance=15.0)
    assert len(rooms) == 2
    assert all(abs(_area_m2(r) - 20.0) < 0.1 for r in rooms)


def test_disconnected_buildings_each_get_their_own_outer_face_excluded():
    main_house = [
        ((0, 0), (8000, 0)), ((8000, 0), (8000, 5000)), ((8000, 5000), (0, 5000)), ((0, 5000), (0, 0)),
        ((4000, 0), (4000, 5000)),
    ]
    detached_garage = [
        ((20000, 0), (25000, 0)), ((25000, 0), (25000, 6000)),
        ((25000, 6000), (20000, 6000)), ((20000, 6000), (20000, 0)),
    ]
    rooms = derive_room_polygons(main_house + detached_garage)
    assert len(rooms) == 3
    areas = sorted(round(_area_m2(r), 1) for r in rooms)
    assert areas == [20.0, 20.0, 30.0]


def test_empty_input_returns_no_rooms():
    assert derive_room_polygons([]) == []


def test_insufficient_segments_returns_no_rooms():
    assert derive_room_polygons([((0, 0), (1000, 0))]) == []


# ── Sanity check ─────────────────────────────────────────────────────

def test_sanity_check_accepts_a_clean_two_room_result():
    segments = [
        ((0, 0), (8000, 0)), ((8000, 0), (8000, 5000)), ((8000, 5000), (0, 5000)), ((0, 5000), (0, 0)),
        ((4000, 0), (4000, 5000)),
    ]
    rooms = derive_room_polygons(segments)
    assert rooms_pass_sanity_check(rooms, (0, 0, 8000, 5000)) is True


def test_sanity_check_rejects_a_single_disproportionate_room():
    """One huge room next to a couple of tiny slivers is exactly the
    signature of an under-connected wall graph — must be rejected."""
    huge_room = [(0.0, 0.0), (100000.0, 0.0), (100000.0, 100000.0), (0.0, 100000.0)]
    tiny_room_1 = [(0.0, 0.0), (100.0, 0.0), (100.0, 100.0), (0.0, 100.0)]
    tiny_room_2 = [(200.0, 0.0), (300.0, 0.0), (300.0, 100.0), (200.0, 100.0)]
    assert rooms_pass_sanity_check(
        [huge_room, tiny_room_1, tiny_room_2], (0, 0, 100000, 100000)
    ) is False


def test_sanity_check_rejects_fewer_than_two_rooms():
    one_room = [(0.0, 0.0), (1000.0, 0.0), (1000.0, 1000.0), (0.0, 1000.0)]
    assert rooms_pass_sanity_check([one_room], (0, 0, 1000, 1000)) is False
    assert rooms_pass_sanity_check([], (0, 0, 1000, 1000)) is False


def test_sanity_check_rejects_low_coverage_of_overall_bounds():
    """Two small rooms found, but they only cover a sliver of the
    drawing's actual bounding box — most of the building is "missing"."""
    small_room_1 = [(0.0, 0.0), (500.0, 0.0), (500.0, 500.0), (0.0, 500.0)]
    small_room_2 = [(600.0, 0.0), (1000.0, 0.0), (1000.0, 500.0), (600.0, 500.0)]
    assert rooms_pass_sanity_check(
        [small_room_1, small_room_2], (0, 0, 100000, 100000)
    ) is False
