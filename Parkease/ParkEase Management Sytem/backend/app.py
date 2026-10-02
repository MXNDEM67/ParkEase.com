import math
import os
import time
import uuid
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from functools import wraps
from typing import Any, cast

import jwt
import mysql.connector
from dotenv import load_dotenv
from flask import Flask, g, jsonify, make_response, request, send_from_directory
from flask_cors import CORS
from werkzeug.exceptions import NotFound
from werkzeug.security import check_password_hash, generate_password_hash

try:
    from database import (
        complete_parking_session,
        create_parking_session,
        ensure_default_admin,
        initialize_database,
        load_parking_state,
        save_settings,
    )
except ImportError:
    from backend.database import (
        complete_parking_session,
        create_parking_session,
        ensure_default_admin,
        initialize_database,
        load_parking_state,
        save_settings,
    )

# ============================================================
# PARK EASE MANAGEMENT SYSTEM
# Python + Flask + MySQL Backend
# ============================================================

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"))
PROJECT_ROOT = os.path.dirname(BASE_DIR)
FRONTEND_DIR = PROJECT_ROOT

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}}, supports_credentials=True)

MYSQL_HOST = os.getenv("MYSQL_HOST", "127.0.0.1")
MYSQL_PORT = int(os.getenv("MYSQL_PORT", "3306"))
MYSQL_USER = os.getenv("MYSQL_USER", "root")
MYSQL_PASSWORD = os.getenv("MYSQL_PASSWORD", "")
MYSQL_DATABASE = os.getenv("MYSQL_DATABASE", "parkease")

SECRET_KEY = os.getenv("SECRET_KEY", "parkease-development-secret-change-this")
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "admin@parkease.com")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin123")
app.config["SECRET_KEY"] = SECRET_KEY
_default_admin: dict[str, Any] | None = None
_database_ready: bool | None = None
_database_retry_after = 0.0


IN_MEMORY_STATE = {
    "settings": {
        "hourlyRate": 10.0,
        "paymentMethods": {"cash": True, "online": True},
    },
    "spaces": [
        {
            "id": f"{chr(65 + (index // 10))}{str((index % 10) + 1).zfill(2)}",
            "status": "available",
            "vehicle": "",
            "ticketNumber": "",
            "startedAt": "",
        }
        for index in range(100)
    ],
    "sessions": [],
    "tickets": [],
}


def db():
    """Return a new MySQL connection when available."""
    return mysql.connector.connect(
        host=MYSQL_HOST,
        port=MYSQL_PORT,
        user=MYSQL_USER,
        password=MYSQL_PASSWORD,
        database=MYSQL_DATABASE,
        autocommit=True,
    )


def _create_admin_record():
    return {
        "id": 1,
        "email": ADMIN_EMAIL,
        "password_hash": generate_password_hash(ADMIN_PASSWORD),
        "full_name": "Administrator",
        "name": "Administrator",
    }


def _ensure_default_admin():
    global _default_admin
    if _default_admin is None:
        _default_admin = _create_admin_record()
    return _default_admin


def _make_json_response(data, status_code=200):
    return make_response(jsonify(data), status_code)


def _normalize_settings(settings: dict[str, Any]) -> dict[str, Any]:
    try:
        hourly_rate = Decimal(str(settings["hourlyRate"]))
    except (KeyError, InvalidOperation, TypeError, ValueError):
        raise ValueError("Hourly rate must be a positive number.") from None

    if (
        not hourly_rate.is_finite()
        or hourly_rate < Decimal("0.01")
        or hourly_rate > Decimal("99999999.99")
    ):
        raise ValueError("Hourly rate must be a positive number within the supported range.")

    payment_methods = settings.get("paymentMethods")
    if not isinstance(payment_methods, dict):
        raise ValueError("Payment methods must be provided.")
    cash_enabled = payment_methods.get("cash")
    online_enabled = payment_methods.get("online")
    if not isinstance(cash_enabled, bool) or not isinstance(online_enabled, bool):
        raise ValueError("Payment method settings must be true or false.")
    if not cash_enabled and not online_enabled:
        raise ValueError("At least one payment method must be enabled.")

    try:
        normalized_hourly_rate = hourly_rate.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except InvalidOperation:
        raise ValueError("Hourly rate has too many decimal places.") from None

    normalized = {
        "hourlyRate": float(normalized_hourly_rate),
        "paymentMethods": {
            "cash": cash_enabled,
            "online": online_enabled,
        },
    }
    return normalized


def _serialize_admin(admin: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": admin.get("id"),
        "email": admin.get("email"),
        "name": admin.get("full_name") or admin.get("name") or admin.get("email"),
    }


def _get_admin_from_db(email: str) -> dict[str, Any] | None:
    connection = None
    cursor = None
    try:
        connection = db()
        cursor = connection.cursor(dictionary=True)
        cursor.execute(
            "SELECT id, email, password_hash, full_name FROM admins WHERE email = %s",
            (email,),
        )
        row = cursor.fetchone()
        if row:
            admin = cast(dict[str, Any], row)
            admin["name"] = admin.get("full_name") or admin.get("email")
            return admin
    except mysql.connector.Error:
        app.logger.exception("Could not retrieve admin from the database")
    finally:
        if cursor is not None:
            cursor.close()
        if connection is not None and connection.is_connected():
            connection.close()
    return None


def _get_admin_by_email(email: str) -> dict[str, Any] | None:
    admin = _get_admin_from_db(email)
    if admin is not None:
        return admin
    default_admin = _ensure_default_admin()
    if email.lower() == default_admin["email"].lower():
        return default_admin
    return None


def build_token(admin: dict[str, Any]) -> str:
    payload = {
        "sub": str(admin.get("id")),
        "email": admin.get("email"),
        "name": admin.get("full_name") or admin.get("name") or admin.get("email"),
        "exp": datetime.now(timezone.utc).timestamp() + (60 * 60 * 8),
    }
    return jwt.encode(payload, app.config["SECRET_KEY"], algorithm="HS256")


def decode_token(token: str | None) -> dict[str, Any] | None:
    if not token:
        return None
    try:
        return jwt.decode(token, app.config["SECRET_KEY"], algorithms=["HS256"])
    except jwt.PyJWTError:
        return None


def token_required(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        token = request.cookies.get("parkEaseToken")
        if not token:
            auth_header = request.headers.get("Authorization", "")
            if auth_header.startswith("Bearer "):
                token = auth_header.split(" ", 1)[1]

        if not token:
            return _make_json_response({"success": False, "message": "Authentication required."}, 401)

        payload = decode_token(token)
        if not payload:
            return _make_json_response({"success": False, "message": "Invalid or expired token."}, 401)

        admin = _get_admin_by_email(payload.get("email", ""))
        if not admin:
            return _make_json_response({"success": False, "message": "Admin not found."}, 401)

        g.current_admin = admin
        return func(*args, **kwargs)

    return wrapper


def _get_space_seed():
    spaces = []
    for index in range(100):
        space_id = f"{chr(65 + (index // 10))}{str((index % 10) + 1).zfill(2)}"
        spaces.append({
            "id": space_id,
            "status": "available",
            "vehicle": "",
            "ticketNumber": "",
            "startedAt": "",
        })
    return spaces


def _json_object() -> dict[str, Any] | None:
    payload = request.get_json(silent=True)
    return payload if isinstance(payload, dict) else None


def _format_duration(elapsed_ms):
    total_minutes = max(0, int(elapsed_ms // 60000))
    hours, minutes = divmod(total_minutes, 60)
    return f"{hours} hr{'s' if hours != 1 else ''} {minutes:02d} min{'s' if minutes != 1 else ''}"


def _load_database_state():
    state = load_parking_state()
    IN_MEMORY_STATE.update(state)


def _database_is_ready():
    global _database_ready, _database_retry_after
    now = time.monotonic()
    if _database_ready is True:
        return True
    if _database_ready is False and now < _database_retry_after:
        return False

    try:
        if not initialize_database():
            app.logger.warning("MySQL is unavailable; using in-memory parking data.")
            _database_ready = False
            _database_retry_after = now + 30
            return False
        if not ensure_default_admin(ADMIN_EMAIL, ADMIN_PASSWORD):
            app.logger.error("The configured admin account could not be initialized.")
        _load_database_state()
        _database_ready = True
    except (mysql.connector.Error, RuntimeError, ValueError):
        app.logger.exception("Could not initialize persistent storage; using in-memory parking data.")
        _database_ready = False
        _database_retry_after = now + 30
    return _database_ready


@app.errorhandler(mysql.connector.Error)
def handle_database_error(error):
    app.logger.error("MySQL request failed: %s", error, exc_info=True)
    return _make_json_response(
        {"success": False, "message": "The database is temporarily unavailable."},
        503,
    )


@app.route("/api/auth/login.php", methods=["POST"])
@app.route("/ParkEase%20Management%20Sytem/backend/api/auth/login.php", methods=["POST"])
def login():
    payload = _json_object()
    if payload is None:
        return _make_json_response({"success": False, "message": "A JSON object is required."}, 400)
    email = str(payload.get("email", "")).strip().lower()
    password = str(payload.get("password", ""))

    if not email or not password:
        return _make_json_response({"success": False, "message": "Email and password are required."}, 400)

    admin = _get_admin_by_email(email)
    if admin is None:
        return _make_json_response({"success": False, "message": "Invalid email or password."}, 401)

    stored_hash = admin.get("password_hash")
    if not isinstance(stored_hash, str) or not check_password_hash(stored_hash, password):
        return _make_json_response({"success": False, "message": "Invalid email or password."}, 401)

    token = build_token(admin)
    response = _make_json_response({"success": True, "admin": _serialize_admin(admin)})
    response.set_cookie(
        "parkEaseToken",
        token,
        httponly=True,
        secure=request.is_secure,
        samesite="Lax",
    )
    return response


@app.route("/api/auth/me.php", methods=["GET"])
@app.route("/ParkEase%20Management%20Sytem/backend/api/auth/me.php", methods=["GET"])
@token_required
def me():
    admin = g.current_admin
    return _make_json_response({"success": True, "admin": _serialize_admin(admin)})


@app.route("/api/auth/logout.php", methods=["POST"])
@app.route("/ParkEase%20Management%20Sytem/backend/api/auth/logout.php", methods=["POST"])
def logout():
    response = _make_json_response({"success": True, "message": "Logged out."})
    response.set_cookie("parkEaseToken", "", expires=0)
    return response


@app.route("/api/settings.php", methods=["GET", "PUT"])
@app.route("/ParkEase%20Management%20Sytem/backend/api/settings.php", methods=["GET", "PUT"])
@token_required
def settings_route():
    database_ready = _database_is_ready()
    if request.method == "GET":
        if database_ready:
            _load_database_state()
        return _make_json_response({"success": True, "settings": IN_MEMORY_STATE["settings"]})

    payload = _json_object()
    if payload is None:
        return _make_json_response({"success": False, "message": "A JSON object is required."}, 400)
    try:
        normalized = _normalize_settings(payload)
    except ValueError as exc:
        return _make_json_response({"success": False, "message": str(exc)}, 400)
    if database_ready:
        save_settings(normalized)
    IN_MEMORY_STATE["settings"] = normalized
    return _make_json_response({"success": True, "settings": normalized})


@app.route("/api/parking/spaces.php", methods=["GET"])
@app.route("/ParkEase%20Management%20Sytem/backend/api/parking/spaces.php", methods=["GET"])
def spaces_route():
    if _database_is_ready():
        _load_database_state()
    spaces = IN_MEMORY_STATE.get("spaces") or _get_space_seed()
    IN_MEMORY_STATE["spaces"] = spaces
    return _make_json_response({"success": True, "spaces": spaces})


@app.route("/api/sessions/active.php", methods=["GET"])
@app.route("/ParkEase%20Management%20Sytem/backend/api/sessions/active.php", methods=["GET"])
def active_sessions():
    if _database_is_ready():
        _load_database_state()
    return _make_json_response({"success": True, "sessions": IN_MEMORY_STATE["sessions"]})


@app.route("/api/tickets/recent.php", methods=["GET"])
@app.route("/ParkEase%20Management%20Sytem/backend/api/tickets/recent.php", methods=["GET"])
def recent_tickets():
    if _database_is_ready():
        _load_database_state()
    return _make_json_response({"success": True, "tickets": IN_MEMORY_STATE["tickets"]})


@app.route("/api/sessions/start.php", methods=["POST"])
@app.route("/ParkEase%20Management%20Sytem/backend/api/sessions/start.php", methods=["POST"])
def start_session():
    payload = _json_object()
    if payload is None:
        return _make_json_response({"success": False, "message": "A JSON object is required."}, 400)
    plate_number = str(payload.get("plateNumber", "")).strip().upper()
    parking_space = str(payload.get("parkingSpace", "")).strip().upper()

    if not plate_number or not parking_space:
        return _make_json_response({"success": False, "message": "Plate number and parking space are required."}, 400)
    if len(plate_number) > 30 or len(parking_space) > 10:
        return _make_json_response({"success": False, "message": "Plate number or parking space is too long."}, 400)

    if _database_is_ready():
        try:
            session = create_parking_session(plate_number, parking_space)
        except ValueError as exc:
            status_code = 404 if str(exc) == "Parking space not found." else 409
            return _make_json_response({"success": False, "message": str(exc)}, status_code)
        _load_database_state()
        return _make_json_response({"success": True, "session": session})

    existing = [session for session in IN_MEMORY_STATE["sessions"] if session["plateNumber"] == plate_number]
    if existing:
        return _make_json_response({"success": False, "message": "A session for this plate number is already active."}, 409)

    space = next((item for item in IN_MEMORY_STATE["spaces"] if item["id"] == parking_space), None)
    if space is None:
        return _make_json_response({"success": False, "message": "Parking space not found."}, 404)
    if space["status"] == "occupied":
        return _make_json_response({"success": False, "message": "Parking space already occupied."}, 409)

    started_at = datetime.now(timezone.utc).isoformat()
    session = {
        "sessionId": f"PS-{uuid.uuid4().hex[:20]}",
        "plateNumber": plate_number,
        "parkingSpace": parking_space,
        "startedAt": started_at,
    }
    space["status"] = "occupied"
    space["vehicle"] = plate_number
    space["ticketNumber"] = session["sessionId"]
    space["startedAt"] = started_at
    IN_MEMORY_STATE["sessions"].append(session)

    return _make_json_response({"success": True, "session": session})


@app.route("/api/sessions/checkout.php", methods=["POST"])
@app.route("/ParkEase%20Management%20Sytem/backend/api/sessions/checkout.php", methods=["POST"])
def checkout_session():
    payload = _json_object()
    if payload is None:
        return _make_json_response({"success": False, "message": "A JSON object is required."}, 400)
    session_id = str(payload.get("sessionId", "")).strip()
    payment_method = str(payload.get("paymentMethod", "cash")).strip().lower()

    if not session_id:
        return _make_json_response({"success": False, "message": "Session ID is required."}, 400)
    if payment_method not in {"cash", "online"}:
        return _make_json_response({"success": False, "message": "Unsupported payment method."}, 400)
    if _database_is_ready():
        try:
            ticket = complete_parking_session(session_id, payment_method)
        except ValueError as exc:
            status_code = 404 if str(exc) == "Session not found." else 400
            return _make_json_response({"success": False, "message": str(exc)}, status_code)
        _load_database_state()
        return _make_json_response({"success": True, "ticket": ticket})
    if not IN_MEMORY_STATE["settings"]["paymentMethods"][payment_method]:
        return _make_json_response({"success": False, "message": "This payment method is disabled."}, 400)

    session = next((item for item in IN_MEMORY_STATE["sessions"] if item["sessionId"] == session_id), None)
    if session is None:
        return _make_json_response({"success": False, "message": "Session not found."}, 404)

    started_at = datetime.fromisoformat(session["startedAt"])
    if started_at.tzinfo is None:
        started_at = started_at.replace(tzinfo=timezone.utc)
    paid_at = datetime.now(timezone.utc)
    elapsed_ms = max(0, (paid_at - started_at).total_seconds() * 1000)
    hours = max(1, math.ceil(elapsed_ms / 3600000))
    amount = (
        Decimal(hours) * Decimal(str(IN_MEMORY_STATE["settings"]["hourlyRate"]))
    ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    ticket = {
        "ticketNumber": f"PK-{uuid.uuid4().hex[:20]}",
        "plateNumber": session["plateNumber"],
        "parkingSpace": session["parkingSpace"],
        "hours": hours,
        "duration": _format_duration(elapsed_ms),
        "elapsedMilliseconds": int(elapsed_ms),
        "amount": float(amount),
        "paymentMethod": payment_method,
        "entryTime": session["startedAt"],
        "paidAt": paid_at.isoformat(),
        "status": "PAID",
    }

    space = next((item for item in IN_MEMORY_STATE["spaces"] if item["id"] == session["parkingSpace"]), None)
    if space is not None:
        space["status"] = "available"
        space["vehicle"] = ""
        space["ticketNumber"] = ""
        space["startedAt"] = ""

    IN_MEMORY_STATE["sessions"] = [item for item in IN_MEMORY_STATE["sessions"] if item["sessionId"] != session_id]
    IN_MEMORY_STATE["tickets"].append(ticket)

    return _make_json_response({"success": True, "ticket": ticket})


@app.route("/api/sessions/lookup.php", methods=["GET"])
@app.route("/ParkEase%20Management%20Sytem/backend/api/sessions/lookup.php", methods=["GET"])
def lookup_session():
    lookup = str(request.args.get("lookup", "")).strip()
    if not lookup:
        return _make_json_response({"success": False, "message": "Lookup value is required."}, 400)

    if _database_is_ready():
        _load_database_state()

    session = next(
        (
            item
            for item in IN_MEMORY_STATE["sessions"]
            if item["plateNumber"].upper() == lookup.upper() or item["parkingSpace"].upper() == lookup.upper()
        ),
        None,
    )
    if session is None:
        return _make_json_response({"success": True, "session": None})
    return _make_json_response({"success": True, "session": session})


@app.route("/")
def index_page():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/ParkEase%20Management%20Sytem")
@app.route("/ParkEase%20Management%20Sytem/<path:path>")
@app.route("/<path:path>")
def serve_frontend(path="index.html"):
    if path.startswith("backend/"):
        return _make_json_response({"success": False, "message": "Invalid route."}, 404)

    safe_path = "index.html" if path in {"", "index.html"} else path
    try:
        return send_from_directory(FRONTEND_DIR, safe_path)
    except NotFound:
        return _make_json_response({"success": False, "message": "Page not found."}, 404)


@app.route("/health")
def health_check():
    return _make_json_response({"success": True, "status": "ok"})


if __name__ == "__main__":
    app.run(
        host=os.getenv("HOST", "127.0.0.1"),
        port=int(os.getenv("PORT", "5000")),
        debug=os.getenv("FLASK_DEBUG", "").lower() == "true",
    )
