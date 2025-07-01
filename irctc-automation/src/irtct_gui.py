import tkinter as tk
from tkinter import ttk, messagebox
import subprocess
import json
import os
import time
import socket

class IRCTCApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("IRCTC Automation")
        self.geometry("420x360")  # Reduced height by 1/4th
        self.resizable(False, False)

        style = ttk.Style(self)
        style.configure("TLabel", font=("Arial", 8))
        style.configure("TEntry", font=("Arial", 8))
        style.configure("TButton", font=("Arial", 8))
        style.configure("TCombobox", font=("Arial", 8))

        # Outer frame for centering
        outer_frame = ttk.Frame(self)
        outer_frame.pack(expand=True, fill="both")

        # Configure grid to center everything
        outer_frame.columnconfigure(0, weight=1)
        outer_frame.rowconfigure(0, weight=1)

        main_frame = ttk.Frame(outer_frame, padding=6)
        main_frame.grid(row=0, column=0, sticky="nsew")
        for i in range(5):
            main_frame.rowconfigure(i, weight=1)
        for i in range(4):
            main_frame.columnconfigure(i, weight=1)

        # FROM and TO
        ttk.Label(main_frame, text="From:").grid(row=0, column=0, sticky="e", pady=1)
        self.from_entry = ttk.Entry(main_frame, width=12)
        self.from_entry.grid(row=0, column=1, pady=1, sticky="w")

        ttk.Label(main_frame, text="To:").grid(row=0, column=2, sticky="e", pady=1)
        self.to_entry = ttk.Entry(main_frame, width=12)
        self.to_entry.grid(row=0, column=3, pady=1, sticky="w")

        # Train Name and Class
        ttk.Label(main_frame, text="Train:").grid(row=1, column=0, sticky="e", pady=1)
        self.train_entry = ttk.Entry(main_frame, width=12)
        self.train_entry.grid(row=1, column=1, pady=1, sticky="w")

        ttk.Label(main_frame, text="Class:").grid(row=1, column=2, sticky="e", pady=1)
        self.class_combo = ttk.Combobox(main_frame, values=["3E", "3A", "2A", "SL", "CC", "2S"], width=10)
        self.class_combo.grid(row=1, column=3, pady=1, sticky="w")
        self.class_combo.set("3E")

        # Number of Passengers
        ttk.Label(main_frame, text="Passengers:").grid(row=2, column=0, sticky="e", pady=1)
        self.num_passengers = tk.IntVar(value=1)
        self.num_pass_spin = ttk.Spinbox(main_frame, from_=1, to=6, textvariable=self.num_passengers, width=5, command=self.update_passenger_fields)
        self.num_pass_spin.grid(row=2, column=1, sticky="w", pady=1)

        # Passenger Details Frame
        self.passenger_frame = ttk.LabelFrame(main_frame, text="Passenger Details", padding="3")
        self.passenger_frame.grid(row=3, column=0, columnspan=4, pady=4, sticky="nsew")
        main_frame.rowconfigure(3, weight=2)
        self.passenger_entries = []
        self.update_passenger_fields()

        # Payment Method
        ttk.Label(main_frame, text="Payment:").grid(row=5, column=0, sticky="e", pady=1)
        self.payment_method = tk.StringVar(value="Credit Card")
        self.payment_combo = ttk.Combobox(main_frame, textvariable=self.payment_method, values=["Credit Card", "Debit Card", "UPI"], width=12, state="readonly")
        self.payment_combo.grid(row=5, column=1, pady=1, sticky="w")
        self.payment_combo.bind("<<ComboboxSelected>>", lambda e: self.update_payment_fields())

        # Payment Details Frame
        self.payment_frame = ttk.LabelFrame(main_frame, text="Payment Details", padding="3")
        self.payment_frame.grid(row=6, column=0, columnspan=4, pady=4, sticky="nsew")
        main_frame.rowconfigure(6, weight=2)
        self.update_payment_fields()

        # Login ID and Password fields
        ttk.Label(main_frame, text="Login ID:").grid(row=8, column=0, sticky="e", pady=1)
        self.login_entry = ttk.Entry(main_frame, width=18)
        self.login_entry.grid(row=8, column=1, pady=1, sticky="w")

        ttk.Label(main_frame, text="Password:").grid(row=8, column=2, sticky="e", pady=1)
        self.password_entry = ttk.Entry(main_frame, width=18, show="*")
        self.password_entry.grid(row=8, column=3, pady=1, sticky="w")

        # Run Button (move it below the new fields)
        self.run_btn = ttk.Button(main_frame, text="Run Automation", command=self.run_automation)
        self.run_btn.grid(row=9, column=0, columnspan=4, pady=4, sticky="n")

    def update_passenger_fields(self):
        for widget in self.passenger_frame.winfo_children():
            widget.destroy()
        self.passenger_entries = []

        num = self.num_passengers.get()
        # Configure columns for even spacing
        for col in range(6):
            self.passenger_frame.columnconfigure(col, weight=1)

        for i in range(num):
            self.passenger_frame.rowconfigure(i, weight=1)
            ttk.Label(self.passenger_frame, text=f"{i+1}.", width=2).grid(row=i, column=0, padx=2, pady=2, sticky="ew")
            name_entry = ttk.Entry(self.passenger_frame, width=12)
            name_entry.grid(row=i, column=1, padx=2, pady=2, sticky="ew")
            ttk.Label(self.passenger_frame, text="Age:", width=3).grid(row=i, column=2, padx=2, pady=2, sticky="ew")
            age_entry = ttk.Entry(self.passenger_frame, width=4)
            age_entry.grid(row=i, column=3, padx=2, pady=2, sticky="ew")
            ttk.Label(self.passenger_frame, text="G:", width=2).grid(row=i, column=4, padx=2, pady=2, sticky="ew")
            gender_combo = ttk.Combobox(self.passenger_frame, values=["M", "F", "O"], width=3)
            gender_combo.grid(row=i, column=5, padx=2, pady=2, sticky="ew")
            gender_combo.set("M")
            self.passenger_entries.append((name_entry, age_entry, gender_combo))

        for j in range(6):
            if j < num:
                continue
            self.passenger_frame.rowconfigure(j, weight=1)

    def is_port_in_use(self, port):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            return s.connect_ex(('localhost', port)) == 0

    def update_payment_fields(self):
        for widget in self.payment_frame.winfo_children():
            widget.destroy()
        method = self.payment_method.get()
        self.payment_entries = {}

        if method in ["Credit Card", "Debit Card"]:
            ttk.Label(self.payment_frame, text="Card Number:").grid(row=0, column=0, sticky="e", padx=2, pady=2)
            card_entry = ttk.Entry(self.payment_frame, width=20)
            card_entry.grid(row=0, column=1, padx=2, pady=2, sticky="w")
            ttk.Label(self.payment_frame, text="Valid Thru (MM/YY):").grid(row=1, column=0, sticky="e", padx=2, pady=2)
            valid_entry = ttk.Entry(self.payment_frame, width=8)
            valid_entry.grid(row=1, column=1, padx=2, pady=2, sticky="w")
            ttk.Label(self.payment_frame, text="CVV:").grid(row=2, column=0, sticky="e", padx=2, pady=2)
            cvv_entry = ttk.Entry(self.payment_frame, width=5, show="*")
            cvv_entry.grid(row=2, column=1, padx=2, pady=2, sticky="w")
            ttk.Label(self.payment_frame, text="Name on Card:").grid(row=3, column=0, sticky="e", padx=2, pady=2)
            name_entry = ttk.Entry(self.payment_frame, width=20)
            name_entry.grid(row=3, column=1, padx=2, pady=2, sticky="w")
            self.payment_entries = {
                "card_number": card_entry,
                "valid_thru": valid_entry,
                "cvv": cvv_entry,
                "card_name": name_entry
            }
        elif method == "UPI":
            ttk.Label(self.payment_frame, text="UPI ID:").grid(row=0, column=0, sticky="e", padx=2, pady=2)
            upi_entry = ttk.Entry(self.payment_frame, width=25)
            upi_entry.grid(row=0, column=1, padx=2, pady=2, sticky="w")
            self.payment_entries = {
                "upi_id": upi_entry
            }

    def run_automation(self):
        from_station = self.from_entry.get().strip().upper()
        to_station = self.to_entry.get().strip().upper()
        train_name = self.train_entry.get().strip().upper()
        train_class = self.class_combo.get().strip().upper()
        num_pass = self.num_passengers.get()

        login_id = self.login_entry.get().strip()
        password = self.password_entry.get().strip()

        if not from_station or not to_station or not train_name or not train_class or not login_id or not password:
            messagebox.showerror("Error", "Please fill all fields including Login ID and Password.")
            return
        if from_station == to_station:
            messagebox.showerror("Error", "From and To stations cannot be the same.")
            return

        passengers = []
        for name_entry, age_entry, gender_combo in self.passenger_entries:
            name = name_entry.get().strip()
            age = age_entry.get().strip()
            gender = gender_combo.get().strip()
            if not name or not age or not gender:
                messagebox.showerror("Error", "Please fill all passenger details.")
                return
            passengers.append({'name': name, 'age': age, 'gender': gender})

        # Get payment method and details
        payment_method = self.payment_method.get()
        payment_details = {}
        if payment_method in ["Credit Card", "Debit Card"]:
            payment_details = {
                "method": payment_method,
                "card_number": self.payment_entries["card_number"].get().strip(),
                "valid_thru": self.payment_entries["valid_thru"].get().strip(),
                "cvv": self.payment_entries["cvv"].get().strip(),
                "card_name": self.payment_entries["card_name"].get().strip()
            }
            if not all(payment_details.values()):
                messagebox.showerror("Error", "Please fill all card details.")
                return
        elif payment_method == "UPI":
            payment_details = {
                "method": payment_method,
                "upi_id": self.payment_entries["upi_id"].get().strip()
            }
            if not payment_details["upi_id"]:
                messagebox.showerror("Error", "Please fill UPI ID.")
                return

        chrome_path = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
        profile_path = r"C:\Users\sagniroy\AppData\Local\Google\Chrome\User Data\Profile 1"
        port = 9222

        # Check if Chrome with CDP is already running
        if self.is_port_in_use(port):
            # messagebox.showinfo("Chrome Running", "Chrome with CDP is already running. Please log in to IRCTC in the open Chrome window. Click OK to continue automation after login.")
            chrome_proc = None
        else:
            chrome_proc = subprocess.Popen([
                chrome_path,
                f'--remote-debugging-port={port}',
                f'--user-data-dir={profile_path}',
                '--no-first-run',
                '--no-default-browser-check'
            ])
            time.sleep(5)
            # messagebox.showinfo("Manual Login", "Please log in to IRCTC in the opened Chrome window. Click OK to continue automation after login.")

        # Run your automation script (Node/TypeScript)
        args = [
            r"C:\Program Files\nodejs\npx.cmd", "ts-node",
            os.path.abspath("irctc-automation/src/automation.ts"),
            "--from", from_station,
            "--to", to_station,
            "--train", train_name,
            "--class", train_class,
            "--passengers", json.dumps(passengers),
            "--payment", json.dumps(payment_details),
            "--username", login_id,
            "--password", password
        ]
        subprocess.run(args, check=True)

        # Optionally, close Chrome after automation
        # chrome_proc.terminate()

if __name__ == "__main__":
    app = IRCTCApp()
    app.mainloop()