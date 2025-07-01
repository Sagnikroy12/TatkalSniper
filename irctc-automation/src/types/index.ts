export interface UserCredentials {
    username: string;
    password: string;
}

export interface LoginResponse {
    success: boolean;
    message: string;
    redirectUrl?: string;
}