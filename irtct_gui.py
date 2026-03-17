"""
IRCTCApp – Tkinter GUI for TatkalSniper Automation
====================================================
Launches a Chrome instance with remote debugging enabled,
then invokes the TypeScript booking automation via ts-node.

All paths are resolved relative to this file so the project
works on any machine regardless of where it is installed.
"""

import tkinter as tk
from tkinter import ttk, messagebox
import subprocess
import json
import os
import time
import socket

# ── Path Constants ─────────────────────────────────────────────────────────────
# Base directory: root of the TatkalSniper project (where this file lives)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# irctc-automation npm project directory
AUTOMATION_DIR = os.path.join(BASE_DIR, "irctc-automation")

# Main TypeScript entry-point
AUTOMATION_SCRIPT = os.path.join(AUTOMATION_DIR, "src", "automation.ts")

# Tesseract training data (used by Node/Tesseract.js; just set for reference)
TESSDATA_DIR = os.path.join(AUTOMATION_DIR, "tessdata")
os.environ["TESSDATA_PREFIX"] = TESSDATA_DIR

# Chrome executable (fall back gracefully if not at the default path)
CHROME_EXE = r"C:\Program Files\Google\Chrome\Application\chrome.exe"

# CDP port
CDP_PORT = 9222

# Chrome user-data profile (Profile 5 is used to keep a clean IRCTC session)
CHROME_PROFILE = os.path.join(
    os.path.expanduser("~"),
    "AppData", "Local", "Google", "Chrome", "User Data", "Profile 5"
)

# npx command
NPX_CMD = r"C:\Program Files\nodejs\npx.cmd"


# ── Helper ─────────────────────────────────────────────────────────────────────

def is_port_in_use(port: int) -> bool:
    """Return True if something is already listening on *port*."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("localhost", port)) == 0


# ── Main Application ───────────────────────────────────────────────────────────

class IRCTCApp(tk.Tk):
    """Main Tkinter window for the IRCTC Tatkal booking automation."""

    def __init__(self) -> None:
        super().__init__()
        self.title("TatkalSniper – IRCTC Automation")
        self.geometry("440x480")
        self.resizable(False, False)

        # Apply a clean, compact style
        style = ttk.Style(self)
        for widget in ("TLabel", "TEntry", "TButton", "TCombobox", "TSpinbox"):
            style.configure(widget, font=("Segoe UI", 9))

        self._build_ui()

    # ── UI Construction ────────────────────────────────────────────────────────

    def _build_ui(self) -> None:
        outer = ttk.Frame(self)
        outer.pack(expand=True, fill="both")
        outer.columnconfigure(0, weight=1)
        outer.rowconfigure(0, weight=1)

        f = ttk.Frame(outer, padding=10)
        f.grid(row=0, column=0, sticky="nsew")
        for col in range(4):
            f.columnconfigure(col, weight=1)

        # ── Row 0: From / To ───────────────────────────────────────────────
        ttk.Label(f, text="From:").grid(row=0, column=0, sticky="e", pady=3)
        self.from_entry = ttk.Entry(f, width=14)
        self.from_entry.grid(row=0, column=1, sticky="w", pady=3)

        ttk.Label(f, text="To:").grid(row=0, column=2, sticky="e", pady=3)
        self.to_entry = ttk.Entry(f, width=14)
        self.to_entry.grid(row=0, column=3, sticky="w", pady=3)

        # ── Row 1: Train / Class ───────────────────────────────────────────
        ttk.Label(f, text="Train:").grid(row=1, column=0, sticky="e", pady=3)
        self.train_entry = ttk.Entry(f, width=14)
        self.train_entry.grid(row=1, column=1, sticky="w", pady=3)

        ttk.Label(f, text="Class:").grid(row=1, column=2, sticky="e", pady=3)
        self.class_combo = ttk.Combobox(
            f, values=["3E", "3A", "2A", "SL", "CC", "2S"], width=12, state="readonly"
        )
        self.class_combo.grid(row=1, column=3, sticky="w", pady=3)
        self.class_combo.set("3E")

        # ── Row 2: Login ID / Password ─────────────────────────────────────
        ttk.Label(f, text="Login ID:").grid(row=2, column=0, sticky="e", pady=3)
        self.login_entry = ttk.Entry(f, width=14)
        self.login_entry.grid(row=2, column=1, sticky="w", pady=3)

        ttk.Label(f, text="Password:").grid(row=2, column=2, sticky="e", pady=3)
        self.password_entry = ttk.Entry(f, width=14, show="*")
        self.password_entry.grid(row=2, column=3, sticky="w", pady=3)

        # ── Row 3: Passenger count spinner ────────────────────────────────
        ttk.Label(f, text="Passengers:").grid(row=3, column=0, sticky="e", pady=3)
        self.num_passengers = tk.IntVar(value=1)
        self.num_pass_spin = ttk.Spinbox(
            f, from_=1, to=6, textvariable=self.num_passengers,
            width=5, command=self.update_passenger_fields
        )
        self.num_pass_spin.grid(row=3, column=1, sticky="w", pady=3)

        # ── Row 4: Passenger details frame ────────────────────────────────
        self.passenger_frame = ttk.LabelFrame(f, text="Passenger Details", padding=4)
        self.passenger_frame.grid(row=4, column=0, columnspan=4, pady=6, sticky="nsew")
        f.rowconfigure(4, weight=2)
        self.passenger_entries: list[tuple] = []
        self.update_passenger_fields()

        # ── Row 5: Payment method ──────────────────────────────────────────
        ttk.Label(f, text="Payment:").grid(row=5, column=0, sticky="e", pady=3)
        self.payment_method = tk.StringVar(value="UPI")
        self.payment_combo = ttk.Combobox(
            f, textvariable=self.payment_method,
            values=["Credit Card", "Debit Card", "UPI"],
            width=14, state="readonly"
        )
        self.payment_combo.grid(row=5, column=1, sticky="w", pady=3)
        self.payment_combo.bind("<<ComboboxSelected>>", lambda _: self.update_payment_fields())

        # ── Row 6: Payment details frame ──────────────────────────────────
        self.payment_frame = ttk.LabelFrame(f, text="Payment Details", padding=4)
        self.payment_frame.grid(row=6, column=0, columnspan=4, pady=6, sticky="nsew")
        f.rowconfigure(6, weight=2)
        self.payment_entries: dict[str, ttk.Entry] = {}
        self.update_payment_fields()

        # ── Row 7: Run button ──────────────────────────────────────────────
        self.run_btn = ttk.Button(f, text="▶  Run Automation", command=self.run_automation)
        self.run_btn.grid(row=7, column=0, columnspan=4, pady=10, sticky="n")

    # ── Dynamic Passenger Rows ─────────────────────────────────────────────────

    def update_passenger_fields(self) -> None:
        """Rebuild the passenger-details grid to match the selected count."""
        for widget in self.passenger_frame.winfo_children():
            widget.destroy()
        self.passenger_entries = []

        num = self.num_passengers.get()
        for col in range(6):
            self.passenger_frame.columnconfigure(col, weight=1)

        for i in range(num):
            self.passenger_frame.rowconfigure(i, weight=1)
            ttk.Label(self.passenger_frame, text=f"{i+1}.").grid(
                row=i, column=0, padx=2, pady=2, sticky="ew"
            )
            name_entry = ttk.Entry(self.passenger_frame, width=13)
            name_entry.grid(row=i, column=1, padx=2, pady=2, sticky="ew")

            ttk.Label(self.passenger_frame, text="Age:").grid(
                row=i, column=2, padx=2, pady=2, sticky="ew"
            )
            age_entry = ttk.Entry(self.passenger_frame, width=4)
            age_entry.grid(row=i, column=3, padx=2, pady=2, sticky="ew")

            ttk.Label(self.passenger_frame, text="G:").grid(
                row=i, column=4, padx=2, pady=2, sticky="ew"
            )
            gender_combo = ttk.Combobox(
                self.passenger_frame, values=["M", "F", "O"], width=3, state="readonly"
            )
            gender_combo.grid(row=i, column=5, padx=2, pady=2, sticky="ew")
            gender_combo.set("M")

            self.passenger_entries.append((name_entry, age_entry, gender_combo))

    # ── Dynamic Payment Fields ─────────────────────────────────────────────────

    def update_payment_fields(self) -> None:
        """Rebuild the payment-details frame to match the selected method."""
        for widget in self.payment_frame.winfo_children():
            widget.destroy()
        self.payment_entries = {}
        method = self.payment_method.get()

        def _row(label: str, row: int, width: int = 22, show: str = "") -> ttk.Entry:
            ttk.Label(self.payment_frame, text=label).grid(
                row=row, column=0, sticky="e", padx=4, pady=2
            )
            entry = ttk.Entry(self.payment_frame, width=width, show=show)
            entry.grid(row=row, column=1, sticky="w", padx=4, pady=2)
            return entry

        if method in ("Credit Card", "Debit Card"):
            self.payment_entries["card_number"] = _row("Card Number:", 0)
            self.payment_entries["valid_thru"]  = _row("Valid Thru (MM/YY):", 1, width=8)
            self.payment_entries["cvv"]         = _row("CVV:", 2, width=5, show="*")
            self.payment_entries["card_name"]   = _row("Name on Card:", 3)
        elif method == "UPI":
            self.payment_entries["upi_id"] = _row("UPI ID:", 0, width=28)

    # ── Validation ─────────────────────────────────────────────────────────────

    def _validate_inputs(self) -> bool:
        """Return False and show an error dialog if any required field is empty."""
        required = {
            "From station": self.from_entry.get().strip(),
            "To station":   self.to_entry.get().strip(),
            "Train name":   self.train_entry.get().strip(),
            "Travel class": self.class_combo.get().strip(),
            "Login ID":     self.login_entry.get().strip(),
            "Password":     self.password_entry.get().strip(),
        }
        for label, value in required.items():
            if not value:
                messagebox.showerror("Validation Error", f"'{label}' cannot be empty.")
                return False

        if required["From station"].upper() == required["To station"].upper():
            messagebox.showerror("Validation Error", "From and To stations cannot be the same.")
            return False

        return True

    # ── Automation Runner ──────────────────────────────────────────────────────

    def run_automation(self) -> None:
        """Validate inputs, launch Chrome if needed, then invoke the TS script."""
        if not self._validate_inputs():
            return

        # Collect form values
        from_station = self.from_entry.get().strip().upper()
        to_station   = self.to_entry.get().strip().upper()
        train_name   = self.train_entry.get().strip().upper()
        train_class  = self.class_combo.get().strip().upper()
        login_id     = self.login_entry.get().strip()
        password     = self.password_entry.get().strip()

        # Collect passengers
        passengers: list[dict] = []
        for name_entry, age_entry, gender_combo in self.passenger_entries:
            name   = name_entry.get().strip()
            age    = age_entry.get().strip()
            gender = gender_combo.get().strip()
            if not name or not age or not gender:
                messagebox.showerror("Validation Error", "Please fill in all passenger details.")
                return
            passengers.append({"name": name, "age": age, "gender": gender})

        # Collect payment details
        method = self.payment_method.get()
        if method in ("Credit Card", "Debit Card"):
            payment_details: dict = {
                "method":      method,
                "card_number": self.payment_entries["card_number"].get().strip(),
                "valid_thru":  self.payment_entries["valid_thru"].get().strip(),
                "cvv":         self.payment_entries["cvv"].get().strip(),
                "card_name":   self.payment_entries["card_name"].get().strip(),
            }
            if not all(v for k, v in payment_details.items() if k != "method"):
                messagebox.showerror("Validation Error", "Please fill in all card details.")
                return
        elif method == "UPI":
            upi_id = self.payment_entries["upi_id"].get().strip()
            if not upi_id:
                messagebox.showerror("Validation Error", "Please enter your UPI ID.")
                return
            payment_details = {"method": "UPI", "upi_id": upi_id}
        else:
            messagebox.showerror("Error", f"Unknown payment method: {method}")
            return

        # ── Launch Chrome if not already running ───────────────────────────
        chrome_proc = None
        if not is_port_in_use(CDP_PORT):
            if not os.path.isfile(CHROME_EXE):
                messagebox.showerror(
                    "Chrome Not Found",
                    f"Chrome executable not found at:\n{CHROME_EXE}\n\n"
                    "Please update CHROME_EXE in irtct_gui.py."
                )
                return
            chrome_proc = subprocess.Popen([
                CHROME_EXE,
                f"--remote-debugging-port={CDP_PORT}",
                f"--user-data-dir={CHROME_PROFILE}",
                "--no-first-run",
                "--no-default-browser-check",
            ])
            time.sleep(5)  # Give Chrome time to start and load the profile

        # ── Build the ts-node command ──────────────────────────────────────
        cmd = [
            NPX_CMD, "ts-node",
            AUTOMATION_SCRIPT,
            "--from",       from_station,
            "--to",         to_station,
            "--train",      train_name,
            "--class",      train_class,
            "--username",   login_id,
            "--password",   password,
            "--passengers", json.dumps(passengers),
            "--payment",    json.dumps(payment_details),
        ]

        # Disable run button while working
        self.run_btn.configure(state="disabled", text="Running…")
        self.update_idletasks()

        try:
            subprocess.run(cmd, check=True, cwd=AUTOMATION_DIR)
            messagebox.showinfo("Success", "Automation completed successfully!")
        except subprocess.CalledProcessError as e:
            messagebox.showerror(
                "Automation Failed",
                f"The automation script exited with code {e.returncode}.\n"
                "Check the terminal for detailed error output."
            )
        except FileNotFoundError:
            messagebox.showerror(
                "npx Not Found",
                f"Could not find npx at:\n{NPX_CMD}\n\n"
                "Please install Node.js or update NPX_CMD in irtct_gui.py."
            )
        finally:
            self.run_btn.configure(state="normal", text="▶  Run Automation")
            # Terminate Chrome only if we launched it
            if chrome_proc is not None:
                chrome_proc.terminate()


# ── Entry Point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    app = IRCTCApp()
    app.mainloop()
