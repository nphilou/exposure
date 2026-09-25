import SwiftUI

/// "Add to Album" from the viewer, like Photos: pick an album or create one.
struct AddToAlbumSheet: View {
    @Environment(ServerStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let photo: Photo

    @State private var naming = false
    @State private var title = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            List {
                Button { naming = true } label: {
                    HStack(spacing: 14) {
                        RoundedRectangle(cornerRadius: 6).fill(.white.opacity(0.08)).frame(width: 52, height: 52)
                            .overlay(Image(systemName: "plus").font(.system(size: 20, weight: .medium)).foregroundStyle(.tint))
                        Text("New Album…").font(.geist(16))
                    }
                }
                ForEach(store.albums) { a in
                    Button { add(to: a.id) } label: {
                        HStack(spacing: 14) {
                            Color.clear.frame(width: 52, height: 52)
                                .overlay { if let c = a.cover, let api = store.api { AuthImage(url: api.thumbURL(c, width: 160)) } else { Theme.skel } }
                                .clipShape(RoundedRectangle(cornerRadius: 6))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(a.title).font(.geist(16))
                                Text(Fmt.photos(a.count)).font(.geist(13)).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            .listStyle(.plain)
            .foregroundStyle(.primary)
            .disabled(busy)
            .navigationTitle("Add to Album")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .alert("New Album", isPresented: $naming) {
                TextField("Title", text: $title)
                Button("Cancel", role: .cancel) { title = "" }
                Button("Save") { add(to: nil) }.disabled(title.trimmingCharacters(in: .whitespaces).isEmpty)
            } message: { Text("Enter a name for this album.") }
            .alert("Couldn’t add the photo", isPresented: .init(get: { error != nil }, set: { if !$0 { error = nil } })) {
                Button("OK", role: .cancel) {}
            } message: { Text(error ?? "") }
        }
        .presentationDetents([.medium, .large])
        .preferredColorScheme(.dark)
        .task { await store.loadCollections() }
    }

    private func add(to album: Int?) {
        busy = true
        Task {
            defer { busy = false }
            do {
                try await store.addToAlbum(photo, album: album, newTitle: title.trimmingCharacters(in: .whitespaces))
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                dismiss()
            } catch { self.error = error.localizedDescription }
        }
    }
}
