import os

try:
    from .database import ensure_default_admin, initialize_database
except ImportError:
    from database import ensure_default_admin, initialize_database


def main():
    admin_email = os.getenv("ADMIN_EMAIL", "admin@parkease.com")
    admin_password = os.getenv("ADMIN_PASSWORD", "admin123")

    if initialize_database():
        print("Database initialized successfully.")
    else:
        print("Database initialization failed. Check MySQL server and credentials.")
        return 1

    if ensure_default_admin(admin_email, admin_password):
        print("Default admin account ready.")
    else:
        print("Default admin account could not be created.")
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
