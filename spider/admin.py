from django.contrib import admin

from .models import SavedHighlight, SavedPaper, SearchLog, Usage

admin.site.site_header = "Paper spider"
admin.site.site_title = "Paper spider"
admin.site.index_title = "Accounts and searches"


@admin.register(Usage)
class UsageAdmin(admin.ModelAdmin):
    list_display = ("user", "use_count", "locked", "locked_at", "updated_at")
    list_filter = ("locked",)
    search_fields = ("user__username",)
    actions = ["unlock_users"]

    @admin.action(description="Unlock selected accounts and give them 10 searches again")
    def unlock_users(self, request, queryset):
        updated = queryset.update(use_count=0, locked=False, locked_at=None)
        if request is not None:
            self.message_user(request, f"Unlocked {updated} account(s).")


class HighlightInline(admin.TabularInline):
    model = SavedHighlight
    extra = 0
    fields = ("question", "quote", "why", "created_at")
    readonly_fields = ("created_at",)


@admin.register(SavedPaper)
class SavedPaperAdmin(admin.ModelAdmin):
    list_display = ("stored_name", "user", "title", "created_at")
    search_fields = ("stored_name", "title", "user__username")
    inlines = [HighlightInline]


@admin.register(SearchLog)
class SearchLogAdmin(admin.ModelAdmin):
    list_display = ("user", "mode", "created_at")
    list_filter = ("mode",)
    search_fields = ("user__username",)
