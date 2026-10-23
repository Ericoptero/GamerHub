from app.domain import normalize_title
from app.integrations.base import Candidate, MatchContext
from app.integrations.matching import decide, query_variants, rank


def cand(cid, name, *, year=None, on=None, kind=None, alts=()):
    return Candidate(provider="t", external_id=str(cid), name=name, year=year, on_platform=on, kind=kind, alt_names=list(alts))


def ctx(name, **kw):
    return MatchContext(name=name, **kw)


def test_normalize_title():
    assert normalize_title("Final Fantasy VI") == "final fantasy 6"
    assert normalize_title("Mega Man X") == "mega man x"
    assert normalize_title("The Witcher® 3: Wild Hunt") == "witcher 3 wild hunt"
    assert normalize_title("Pokémon Trading Card Game") == "pokemon trading card game"
    assert normalize_title("F.E.A.R.") == "f e a r"
    assert normalize_title("Ratchet & Clank") == "ratchet and clank"


def test_query_variants():
    assert query_variants("Final Fantasy III (VI)") == [("final fantasy 3 6", 0.0), ("final fantasy 3", 5.0)]
    assert query_variants("Castlevania: Aria of sorrow")[-1] == ("castlevania", 15.0)


def test_exact_beats_sequel_and_edition():
    ranked = rank([cand(1, "Hollow Knight: Silksong", on=True), cand(2, "Hollow Knight", on=True)], ctx("Hollow Knight"))
    assert decide(ranked) == ("matched", ranked[0]) and ranked[0].external_id == "2"

    ranked = rank([cand(1, "Hades II", on=True), cand(2, "Hades", on=True)], ctx("Hades"))
    assert decide(ranked)[1].external_id == "2"


def test_edition_suffix_matches():
    ranked = rank([cand(1, "Pokemon Emerald Version", on=True), cand(2, "Pokemon Scarlet", on=False)], ctx("Pokémon Emerald"))
    status, best = decide(ranked)
    assert status == "matched" and best.external_id == "1"


def test_platform_disambiguates_resident_evil_3():
    remake = cand(1, "Resident Evil 3", year=2020)
    nemesis = cand(2, "Resident Evil 3: Nemesis", year=1999)
    remake.on_platform, nemesis.on_platform = True, True  # Nemesis também saiu para PC
    status, best = decide(rank([remake.model_copy(), nemesis.model_copy()], ctx("Resident Evil 3", platform="PC")))
    assert status == "matched" and best.external_id == "1"

    remake.on_platform, nemesis.on_platform = False, True  # no PS1 só existe o original
    status, best = decide(rank([remake, nemesis], ctx("Resident Evil 3", platform="PS1")))
    assert status == "matched" and best.external_id == "2"


def test_final_fantasy_iii_vi_uses_platform_and_alias():
    ff6 = cand(6, "Final Fantasy VI", on=True, alts=["Final Fantasy III"])
    ff3 = cand(3, "Final Fantasy III", on=False)
    status, best = decide(rank([ff3, ff6], ctx("Final Fantasy III (VI)", platform="SNES")))
    assert status == "matched" and best.external_id == "6"


def test_dlc_penalized_unless_asked():
    base = cand(1, "Xenoblade Chronicles 3", on=True)
    dlc = cand(2, "Xenoblade Chronicles 3: Expansion Pass", on=True, kind="dlc")
    status, best = decide(rank([base.model_copy(), dlc.model_copy()], ctx("Xenoblade Chronicles 3")))
    assert best.external_id == "1"
    status, best = decide(rank([base, dlc], ctx("Xenoblade Chronicles™ 3 Expansion Pass")))
    assert status == "matched" and best.external_id == "2"


def test_ambiguous_and_not_found():
    ranked = rank([cand(1, "Doom", year=1993), cand(2, "Doom", year=2016)], ctx("DOOM"))
    assert decide(ranked) == ("ambiguous", None)
    ranked = rank([cand(1, "Doom", year=1993), cand(2, "Doom", year=2016)], ctx("DOOM", year=2016))
    assert decide(ranked)[1].external_id == "2"
    assert decide(rank([cand(1, "Something Else Entirely")], ctx("F.E.A.R."))) == ("not_found", None)
    assert decide([]) == ("not_found", None)


def test_punctuation_titles():
    ranked = rank([cand(1, "F.E.A.R.", on=True), cand(2, "F.E.A.R. 2: Project Origin", on=True)], ctx("F.E.A.R."))
    assert decide(ranked)[1].external_id == "1"
    ranked = rank([cand(1, "Pokémon Trading Card Game", on=True)], ctx("Pokemon Trading Card Game"))
    assert decide(ranked)[0] == "matched"
