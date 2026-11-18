@testable import App
import XCTVapor

final class LoanTests: XCTestCase {
    private func borrow(
        _ app: Application,
        gameID: UUID,
        memberID: UUID,
        afterResponse: (XCTHTTPResponse) async throws -> Void
    ) async throws {
        try await app.test(.POST, "loans", beforeRequest: { req in
            try req.content.encode(CreateLoanDTO(gameID: gameID, memberID: memberID))
        }, afterResponse: afterResponse)
    }

    func testBorrowGameReturnsCreated() async throws {
        try await withApp { app in
            let game = try await createGame(app)
            let member = try await createMember(app)

            try await borrow(
                app, gameID: try XCTUnwrap(game.id), memberID: try XCTUnwrap(member.id)
            ) { res in
                XCTAssertEqual(res.status, .created)
                let loan = try res.content.decode(LoanDTO.self)
                XCTAssertEqual(loan.gameID, game.id)
                XCTAssertEqual(loan.memberID, member.id)
                XCTAssertNil(loan.returnedAt)
            }
        }
    }

    func testDueDateIsFourteenDaysAfterBorrowDate() async throws {
        try await withApp { app in
            let game = try await createGame(app)
            let member = try await createMember(app)

            try await borrow(
                app, gameID: try XCTUnwrap(game.id), memberID: try XCTUnwrap(member.id)
            ) { res in
                let loan = try res.content.decode(LoanDTO.self)
                var calendar = Calendar(identifier: .gregorian)
                calendar.timeZone = TimeZone(secondsFromGMT: 0)!
                let days = calendar.dateComponents([.day], from: loan.borrowedAt, to: loan.dueAt).day
                XCTAssertEqual(days, 14)
            }
        }
    }

    func testBorrowedGameIsNoLongerAvailable() async throws {
        try await withApp { app in
            let game = try await createGame(app)
            let member = try await createMember(app)
            let gameID = try XCTUnwrap(game.id)

            try await borrow(app, gameID: gameID, memberID: try XCTUnwrap(member.id)) { _ in }

            try await app.test(.GET, "games/\(gameID)", afterResponse: { res async throws in
                XCTAssertFalse(try res.content.decode(GameDTO.self).isAvailable)
            })
        }
    }

    func testBorrowingAGameAlreadyOnLoanReturnsConflict() async throws {
        try await withApp { app in
            let game = try await createGame(app)
            let first = try await createMember(app, email: "first@example.com")
            let second = try await createMember(app, name: "Alex", email: "second@example.com")
            let gameID = try XCTUnwrap(game.id)

            try await borrow(app, gameID: gameID, memberID: try XCTUnwrap(first.id)) { _ in }
            try await borrow(app, gameID: gameID, memberID: try XCTUnwrap(second.id)) { res in
                XCTAssertEqual(res.status, .conflict)
            }
        }
    }

    func testBorrowUnknownGameReturnsNotFound() async throws {
        try await withApp { app in
            let member = try await createMember(app)

            try await borrow(app, gameID: UUID(), memberID: try XCTUnwrap(member.id)) { res in
                XCTAssertEqual(res.status, .notFound)
            }
        }
    }

    func testBorrowWithUnknownMemberReturnsNotFound() async throws {
        try await withApp { app in
            let game = try await createGame(app)

            try await borrow(app, gameID: try XCTUnwrap(game.id), memberID: UUID()) { res in
                XCTAssertEqual(res.status, .notFound)
            }
        }
    }

    // MARK: - GET /loans/overdue

    func testOverdueListsOnlyUnreturnedPastDueLoansMostOverdueFirst() async throws {
        try await withApp { app in
            let catan = try await createGame(app, title: "Catan")
            let dixit = try await createGame(app, title: "Dixit")
            let azul = try await createGame(app, title: "Azul")
            let skyjo = try await createGame(app, title: "Skyjo")
            let member = try await createMember(app)
            let memberID = try XCTUnwrap(member.id)
            let day: TimeInterval = 86_400
            let now = Date()

            // Overdue by 2 days.
            try await insertLoan(app, gameID: try XCTUnwrap(catan.id), memberID: memberID,
                                 borrowedAt: now - 16 * day, dueAt: now - 2 * day)
            // Overdue by 10 days: must come first.
            try await insertLoan(app, gameID: try XCTUnwrap(dixit.id), memberID: memberID,
                                 borrowedAt: now - 24 * day, dueAt: now - 10 * day)
            // Past due but returned: never overdue.
            try await insertLoan(app, gameID: try XCTUnwrap(azul.id), memberID: memberID,
                                 borrowedAt: now - 30 * day, dueAt: now - 16 * day, returnedAt: now - 1 * day)
            // Ongoing, not due yet.
            try await insertLoan(app, gameID: try XCTUnwrap(skyjo.id), memberID: memberID,
                                 borrowedAt: now, dueAt: now + 14 * day)

            try await app.test(.GET, "loans/overdue", afterResponse: { res async throws in
                XCTAssertEqual(res.status, .ok)
                let loans = try res.content.decode([LoanDTO].self)
                XCTAssertEqual(loans.map(\.gameID), [dixit.id, catan.id])
            })
        }
    }

    func testOverdueIsEmptyWhenNothingIsLate() async throws {
        try await withApp { app in
            let game = try await createGame(app)
            let member = try await createMember(app)
            try await borrow(app, gameID: try XCTUnwrap(game.id), memberID: try XCTUnwrap(member.id)) { _ in }

            try await app.test(.GET, "loans/overdue", afterResponse: { res async throws in
                XCTAssertEqual(res.status, .ok)
                XCTAssertEqual(try res.content.decode([LoanDTO].self).count, 0)
            })
        }
    }

    // MARK: - POST /loans/:loanID/return

    func testReturningALoanSetsReturnedAtAndMakesTheGameAvailable() async throws {
        try await withApp { app in
            let game = try await createGame(app)
            let member = try await createMember(app)
            let gameID = try XCTUnwrap(game.id)
            var loanID: UUID?
            try await borrow(app, gameID: gameID, memberID: try XCTUnwrap(member.id)) { res in
                loanID = try res.content.decode(LoanDTO.self).id
            }

            try await app.test(.POST, "loans/\(try XCTUnwrap(loanID))/return", afterResponse: { res async throws in
                XCTAssertEqual(res.status, .ok)
                let loan = try res.content.decode(LoanDTO.self)
                XCTAssertEqual(loan.id, loanID)
                XCTAssertNotNil(loan.returnedAt)
            })
            try await app.test(.GET, "games/\(gameID)", afterResponse: { res async throws in
                XCTAssertTrue(try res.content.decode(GameDTO.self).isAvailable)
            })
        }
    }

    func testReturningALoanTwiceReturnsConflict() async throws {
        try await withApp { app in
            let game = try await createGame(app)
            let member = try await createMember(app)
            var loanID: UUID?
            try await borrow(app, gameID: try XCTUnwrap(game.id), memberID: try XCTUnwrap(member.id)) { res in
                loanID = try res.content.decode(LoanDTO.self).id
            }
            let path = "loans/\(try XCTUnwrap(loanID))/return"

            try await app.test(.POST, path, afterResponse: { res async throws in
                XCTAssertEqual(res.status, .ok)
            })
            try await app.test(.POST, path, afterResponse: { res async throws in
                XCTAssertEqual(res.status, .conflict)
            })
        }
    }

    func testReturningAnUnknownLoanReturnsNotFound() async throws {
        try await withApp { app in
            try await app.test(.POST, "loans/\(UUID())/return", afterResponse: { res async throws in
                XCTAssertEqual(res.status, .notFound)
            })
        }
    }

    func testReturningALoanWithMalformedIDReturnsBadRequest() async throws {
        try await withApp { app in
            try await app.test(.POST, "loans/not-a-uuid/return", afterResponse: { res async throws in
                XCTAssertEqual(res.status, .badRequest)
            })
        }
    }
}
