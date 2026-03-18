/**
 * Shared type definitions for the TatkalSniper IRCTC Automation.
 */

/** IRCTC login credentials */
export interface UserCredentials {
    username: string;
    password: string;
}

/** Result returned after the login + booking flow */
export interface LoginResponse {
    success: boolean;
    message: string;
}

/** Passenger information for booking */
export interface Passenger {
    name: string;
    age: string;
    gender: 'M' | 'F' | 'O';
}

/** Payment details passed from the GUI */
export interface PaymentDetails {
    method: 'Credit Card' | 'Debit Card' | 'UPI';
    // Card-based payment
    card_number?: string;
    valid_thru?: string;
    cvv?: string;
    card_name?: string;
    // UPI
    upi_id?: string;
}

/** All CLI arguments parsed by minimist */
export interface CliArgs {
    username: string;
    password: string;
    from: string;
    to: string;
    train: string;
    class: string;
    passengers: string; // JSON string
    payment: string;    // JSON string
    [key: string]: unknown;
}
