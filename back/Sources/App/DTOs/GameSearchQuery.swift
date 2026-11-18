import Vapor

/// Query parameters of `GET /games`. Every parameter is optional; the ones
/// provided are combined (a game must satisfy all of them).
struct GameSearchQuery: Content, Validatable {
    let q: String?
    let players: Int?
    let maxDuration: Int?

    static func validations(_ validations: inout Validations) {
        // `required: false`: the parameter may be missing, but when present
        // it must be a strictly positive integer.
        validations.add("players", as: Int.self, is: .range(1...), required: false)
        validations.add("maxDuration", as: Int.self, is: .range(1...), required: false)
    }
}
