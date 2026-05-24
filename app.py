from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

import pandas as pd
import streamlit as st
from sportscore import SportScoreClient
from streamlit_autorefresh import st_autorefresh


APP_TITLE = "Tennis Live Scores"
REFRESH_INTERVAL_MS = 60_000


st.set_page_config(
    page_title=APP_TITLE,
    page_icon="🎾",
    layout="wide",
    initial_sidebar_state="expanded",
)


def as_list(payload: Any) -> list[dict[str, Any]]:
    """Normalize common API response envelopes into a list of dictionaries."""
    if payload is None:
        return []
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if isinstance(payload, dict):
        for key in ("data", "matches", "standings", "rankings", "results", "items"):
            value = payload.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]
        nested = payload.get("data")
        if isinstance(nested, dict):
            return as_list(nested)
    return []


def first_value(source: dict[str, Any], *keys: str, default: Any = "") -> Any:
    for key in keys:
        value = source.get(key)
        if value not in (None, ""):
            return value
    return default


def nested_value(source: dict[str, Any], *paths: tuple[str, ...], default: Any = "") -> Any:
    for path in paths:
        cursor: Any = source
        for key in path:
            if not isinstance(cursor, dict) or key not in cursor:
                cursor = None
                break
            cursor = cursor[key]
        if cursor not in (None, ""):
            return cursor
    return default


def clean_text(value: Any, fallback: str = "TBD") -> str:
    if value is None:
        return fallback
    text = str(value).strip()
    return text if text else fallback


def parse_datetime(value: Any) -> datetime | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(value, tz=timezone.utc).astimezone()
        except (OverflowError, OSError, ValueError):
            return None
    if isinstance(value, str):
        normalized = value.strip().replace("Z", "+00:00")
        for candidate in (normalized, normalized.split(".")[0]):
            try:
                parsed = datetime.fromisoformat(candidate)
                return parsed.astimezone() if parsed.tzinfo else parsed
            except ValueError:
                continue
    return None


def match_status(match: dict[str, Any]) -> str:
    raw = first_value(
        match,
        "status",
        "state",
        "match_status",
        "matchStatus",
        "event_status",
        default="",
    )
    if isinstance(raw, dict):
        raw = first_value(raw, "type", "name", "slug", "description", default="")
    return str(raw).strip().lower()


def is_live_match(match: dict[str, Any]) -> bool:
    status = match_status(match)
    return status in {"live", "inprogress", "in_progress", "running", "started"} or bool(
        first_value(match, "is_live", "isLive", "live", default=False)
    )


def is_upcoming_match(match: dict[str, Any]) -> bool:
    status = match_status(match)
    if status in {"upcoming", "scheduled", "notstarted", "not_started", "pre"}:
        return True
    start = get_match_time(match)
    return start is not None and start.date() == date.today() and not is_live_match(match)


def get_match_time(match: dict[str, Any]) -> datetime | None:
    value = first_value(
        match,
        "start_time",
        "startTime",
        "scheduled",
        "scheduled_at",
        "scheduledAt",
        "date",
        "time",
        "commence_time",
        default=None,
    )
    return parse_datetime(value)


def player_name(entity: Any) -> str:
    if isinstance(entity, str):
        return clean_text(entity)
    if isinstance(entity, dict):
        return clean_text(
            first_value(
                entity,
                "name",
                "full_name",
                "fullName",
                "display_name",
                "displayName",
                "short_name",
                "shortName",
                default="TBD",
            )
        )
    return "TBD"


def get_competitors(match: dict[str, Any]) -> tuple[str, str]:
    home = nested_value(
        match,
        ("home_team",),
        ("homeTeam",),
        ("home_player",),
        ("homePlayer",),
        ("competitors", "home"),
        default=None,
    )
    away = nested_value(
        match,
        ("away_team",),
        ("awayTeam",),
        ("away_player",),
        ("awayPlayer",),
        ("competitors", "away"),
        default=None,
    )

    if home is not None or away is not None:
        return player_name(home), player_name(away)

    competitors = first_value(match, "competitors", "players", "participants", default=[])
    if isinstance(competitors, list) and competitors:
        names = [player_name(item) for item in competitors[:2]]
        while len(names) < 2:
            names.append("TBD")
        return names[0], names[1]

    return (
        clean_text(first_value(match, "home_name", "player1", "player_one", default="TBD")),
        clean_text(first_value(match, "away_name", "player2", "player_two", default="TBD")),
    )


def get_score(match: dict[str, Any]) -> str:
    score = first_value(match, "score", "scores", "current_score", "currentScore", default="")
    if isinstance(score, str) and score.strip():
        return score.strip()
    if isinstance(score, dict):
        home = first_value(score, "home", "home_score", "homeScore", "player1", default="")
        away = first_value(score, "away", "away_score", "awayScore", "player2", default="")
        if home != "" or away != "":
            return f"{home} - {away}"
        sets = first_value(score, "sets", "periods", default=[])
        if isinstance(sets, list) and sets:
            rendered_sets = []
            for item in sets:
                if isinstance(item, dict):
                    left = first_value(item, "home", "home_score", "player1", default="")
                    right = first_value(item, "away", "away_score", "player2", default="")
                    rendered_sets.append(f"{left}-{right}")
            if rendered_sets:
                return "  ".join(rendered_sets)
    home = first_value(match, "home_score", "homeScore", default="")
    away = first_value(match, "away_score", "awayScore", default="")
    return f"{home} - {away}" if home != "" or away != "" else "Score pending"


def tournament_name(match: dict[str, Any]) -> str:
    tournament = first_value(match, "tournament", "league", "competition", "event", default="")
    if isinstance(tournament, dict):
        return clean_text(first_value(tournament, "name", "title", "slug", default="Tournament TBD"))
    return clean_text(tournament, "Tournament TBD")


def player_slug(row: pd.Series) -> str:
    slug = row.get("Slug", "")
    if isinstance(slug, str) and slug.strip():
        return slug.strip()
    name = str(row.get("Player Name", "")).strip().lower()
    return "-".join(part for part in name.replace(".", "").split() if part)


@st.cache_resource(show_spinner=False)
def get_client() -> SportScoreClient:
    return SportScoreClient()


@st.cache_data(ttl=45, show_spinner=False)
def fetch_matches(refresh_key: int = 0) -> list[dict[str, Any]]:
    del refresh_key
    return as_list(get_client().get_matches(sport="tennis"))


@st.cache_data(ttl=60 * 30, show_spinner=False)
def fetch_standings(slug: str) -> list[dict[str, Any]]:
    return as_list(get_client().get_standings(sport="tennis", slug=slug))


@st.cache_data(ttl=60 * 60, show_spinner=False)
def fetch_player(slug: str) -> dict[str, Any]:
    payload = get_client().get_player(sport="tennis", slug=slug)
    if isinstance(payload, dict):
        data = payload.get("data")
        return data if isinstance(data, dict) else payload
    return {}


def rankings_frame(rows: list[dict[str, Any]]) -> pd.DataFrame:
    normalized = []
    for index, row in enumerate(rows, start=1):
        player = first_value(row, "player", "team", "competitor", "participant", default=row)
        if not isinstance(player, dict):
            player = {"name": player}

        normalized.append(
            {
                "Rank": first_value(row, "rank", "position", "place", default=index),
                "Player Name": player_name(player),
                "Country": clean_text(
                    first_value(
                        row,
                        "country",
                        "country_name",
                        "countryName",
                        default=first_value(player, "country", "country_name", "countryName", default="-"),
                    ),
                    "-",
                ),
                "Points": first_value(row, "points", "score", "rating", default="-"),
                "Slug": first_value(row, "slug", default=first_value(player, "slug", default="")),
            }
        )
    return pd.DataFrame(normalized)


def render_sidebar() -> None:
    st.sidebar.title("Tennis Center")
    st.sidebar.caption("Live scores, daily schedules, rankings, and player snapshots.")
    st.sidebar.markdown("[Powered by SportScore](https://sportscore.com)")
    st.sidebar.divider()
    st.sidebar.info(
        "Live scores refresh every 60 seconds. Rankings and player details are cached to keep requests light."
    )


def render_live_scores(matches: list[dict[str, Any]]) -> None:
    live_matches = [match for match in matches if is_live_match(match)]

    left, middle, right = st.columns(3)
    left.metric("Live Matches", len(live_matches))
    middle.metric("Refresh Interval", "60 sec")
    right.metric("Data Source", "SportScore")

    if not live_matches:
        st.info("No tennis matches are live right now.")
        return

    for match in live_matches:
        home, away = get_competitors(match)
        with st.container(border=True):
            st.caption(tournament_name(match))
            cols = st.columns([3, 1, 3])
            cols[0].subheader(home)
            cols[1].metric("Score", get_score(match))
            cols[2].subheader(away)
            detail = first_value(match, "round", "season", "venue", default="")
            if detail:
                st.caption(str(detail))


def render_upcoming(matches: list[dict[str, Any]]) -> None:
    upcoming = [match for match in matches if is_upcoming_match(match)]
    today = date.today()

    rows = []
    for match in upcoming:
        start = get_match_time(match)
        if start is not None and start.date() != today:
            continue
        home, away = get_competitors(match)
        rows.append(
            {
                "Time": start.strftime("%I:%M %p") if start else "TBD",
                "Match": f"{home} vs {away}",
                "Tournament": tournament_name(match),
                "Status": match_status(match).title() or "Upcoming",
            }
        )

    st.metric("Today's Scheduled Matches", len(rows))
    if rows:
        st.dataframe(pd.DataFrame(rows), hide_index=True, use_container_width=True)
    else:
        st.info("No scheduled tennis matches found for today.")


def render_player_details(player: pd.Series) -> None:
    slug = player_slug(player)
    if not slug:
        st.warning("No player slug is available for this ranking row.")
        return

    with st.spinner(f"Loading {player['Player Name']} details..."):
        try:
            details = fetch_player(slug)
        except Exception as exc:
            st.error(f"Could not load player details: {exc}")
            return

    if not details:
        st.info("No player detail data is available yet.")
        return

    with st.expander(f"{player['Player Name']} stats", expanded=True):
        metric_cols = st.columns(4)
        metric_cols[0].metric("Country", clean_text(first_value(details, "country", "country_name", default=player["Country"]), "-"))
        metric_cols[1].metric("Rank", clean_text(first_value(details, "rank", "position", default=player["Rank"]), "-"))
        metric_cols[2].metric("Points", clean_text(first_value(details, "points", default=player["Points"]), "-"))
        metric_cols[3].metric("Rating", clean_text(first_value(details, "rating", "utr", "utr_rating", default="N/A"), "N/A"))
        st.json(details, expanded=False)


def render_rankings(title: str, rows: list[dict[str, Any]], search_key: str, select_key: str) -> None:
    st.subheader(title)
    frame = rankings_frame(rows)
    if frame.empty:
        st.info("No rankings data is available right now.")
        return

    query = st.text_input("Search by player name", key=search_key, placeholder="Type a player name...")
    visible = frame
    if query.strip():
        visible = frame[frame["Player Name"].str.contains(query.strip(), case=False, na=False)]

    st.metric("Players Displayed", len(visible))
    st.dataframe(
        visible.drop(columns=["Slug"], errors="ignore"),
        hide_index=True,
        use_container_width=True,
    )

    st.caption("Open player details")
    names = visible["Player Name"].tolist()
    selected_name = st.selectbox(
        "Choose a ranked player",
        options=[""] + names,
        format_func=lambda value: "Select a player..." if value == "" else value,
        key=select_key,
        label_visibility="collapsed",
    )
    if selected_name:
        selected = visible[visible["Player Name"] == selected_name].iloc[0]
        render_player_details(selected)


def render_injuries() -> None:
    st.subheader("Player Injury News")
    st.info("Injury reports from official ATP/WTA channels coming soon")
    st.write(
        "This section is ready for official injury feeds or SportScore match metadata when available."
    )


def main() -> None:
    render_sidebar()
    st.title(APP_TITLE)
    st.caption("Real-time tennis coverage using the free SportScore API.")

    tabs = st.tabs(["Live Scores", "Upcoming", "ATP Rankings", "WTA Rankings", "Injuries"])

    with tabs[0]:
        refresh_count = st_autorefresh(interval=REFRESH_INTERVAL_MS, key="live_refresh")
        try:
            with st.spinner("Loading live tennis scores..."):
                matches = fetch_matches(refresh_count)
            render_live_scores(matches)
        except Exception as exc:
            st.error(f"SportScore live scores could not be loaded: {exc}")

    with tabs[1]:
        try:
            with st.spinner("Loading today's tennis schedule..."):
                matches = fetch_matches()
            render_upcoming(matches)
        except Exception as exc:
            st.error(f"SportScore upcoming matches could not be loaded: {exc}")

    with tabs[2]:
        try:
            with st.spinner("Loading ATP rankings..."):
                render_rankings("ATP Rankings", fetch_standings("atp-tour"), "atp_search", "atp_select")
        except Exception as exc:
            st.error(f"ATP rankings could not be loaded: {exc}")

    with tabs[3]:
        try:
            with st.spinner("Loading WTA rankings..."):
                render_rankings("WTA Rankings", fetch_standings("wta-tour"), "wta_search", "wta_select")
        except Exception as exc:
            st.error(f"WTA rankings could not be loaded: {exc}")

    with tabs[4]:
        render_injuries()

    st.divider()
    st.markdown('Powered by [SportScore](https://sportscore.com)')


if __name__ == "__main__":
    main()
