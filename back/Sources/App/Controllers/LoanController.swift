import Fluent
import Vapor

struct LoanController: RouteCollection {
    func boot(routes: any RoutesBuilder) throws {
        let loans = routes.grouped("loans")
        loans.post(use: create)
        loans.get("overdue", use: overdue)
        loans.post(":loanID", "return", use: giveBack)
    }

    @Sendable
    func overdue(req: Request) async throws -> [LoanDTO] {
        // Not returned and past due. A returned loan is never overdue.
        try await Loan.query(on: req.db)
            .filter(\.$returnedAt == nil)
            .filter(\.$dueAt < Date())
            .sort(\.$dueAt, .ascending) // the oldest due date is the most overdue
            .all()
            .map { $0.toDTO() }
    }

    @Sendable
    func create(req: Request) async throws -> Response {
        let dto = try req.content.decode(CreateLoanDTO.self)

        guard let game = try await Game.query(on: req.db)
            .filter(\.$id == dto.gameID)
            .with(\.$loans)
            .first()
        else {
            throw Abort(.notFound, reason: "Game not found")
        }
        guard game.isAvailable else {
            throw Abort(.conflict, reason: "Game is already on loan")
        }
        guard let member = try await Member.find(dto.memberID, on: req.db) else {
            throw Abort(.notFound, reason: "Member not found")
        }

        let now = Date()
        let loan = Loan(
            gameID: try game.requireID(),
            memberID: try member.requireID(),
            borrowedAt: now,
            dueAt: try Loan.dueDate(from: now)
        )
        try await loan.save(on: req.db)
        return try await loan.toDTO().encodeResponse(status: .created, for: req)
    }

    // `return` is a Swift keyword, hence the name `giveBack`.
    @Sendable
    func giveBack(req: Request) async throws -> LoanDTO {
        let loan = try await findLoan(req)
        guard loan.returnedAt == nil else {
            throw Abort(.conflict, reason: "Loan is already returned")
        }
        // The game becomes available again: `isAvailable` only looks for loans without `returnedAt`.
        loan.returnedAt = Date()
        try await loan.save(on: req.db)
        return loan.toDTO()
    }

    private func findLoan(_ req: Request) async throws -> Loan {
        guard let loanID = req.parameters.get("loanID", as: UUID.self) else {
            throw Abort(.badRequest, reason: "Invalid loan id")
        }
        guard let loan = try await Loan.find(loanID, on: req.db) else {
            throw Abort(.notFound, reason: "Loan not found")
        }
        return loan
    }
}
