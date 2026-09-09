import React, { useState, useMemo } from 'react';
import { 
  Folders, Plus, Trash2, Edit2, CheckCircle2, Search, 
  X, Image as ImageIcon, ExternalLink, Tag, Package 
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Category } from '../types';
import { AdminConfirmDialog } from '../components/admin/AdminConfirmDialog';
import { AdminModalShell } from '../components/admin/AdminModalShell';

export function CategoriesAdmin() {
  // Use the context CRUD helpers, not setCategories: they persist to
  // /api/categories and emit the audit trail.
  const { categories, products, addCategory, updateCategory, deleteCategory, language } = useApp();
  
  // Creation form state
  const [name, setName] = useState('');
  const [nameBn, setNameBn] = useState('');
  const [description, setDescription] = useState('');
  const [image, setImage] = useState('');
  const [saving, setSaving] = useState(false);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');

  // Edit Modal state
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [editName, setEditName] = useState('');
  const [editNameBn, setEditNameBn] = useState('');
  const [editSlug, setEditSlug] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editImage, setEditImage] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);

  // Delete Dialog state
  const [categoryToDelete, setCategoryToDelete] = useState<Category | null>(null);

  const isBn = language === 'BN';

  // Filtered categories
  const filteredCategories = useMemo(() => {
    if (!searchQuery.trim()) return categories;
    const q = searchQuery.toLowerCase();
    return categories.filter(cat => 
      cat.name.toLowerCase().includes(q) ||
      (cat.nameBn && cat.nameBn.toLowerCase().includes(q)) ||
      cat.slug.toLowerCase().includes(q) ||
      (cat.description && cat.description.toLowerCase().includes(q))
    );
  }, [categories, searchQuery]);

  // Handle Add Category
  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || saving) return;

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    setSaving(true);
    try {
      await addCategory({
        name: name.trim(),
        nameBn: (nameBn || name).trim(),
        slug,
        description: description.trim(),
        image: image.trim() || 'https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&q=80&w=800',
        itemCount: 0,
      });
      setName('');
      setNameBn('');
      setDescription('');
      setImage('');
    } finally {
      setSaving(false);
    }
  };

  // Open Edit Modal
  const handleOpenEdit = (cat: Category) => {
    setEditingCategory(cat);
    setEditName(cat.name);
    setEditNameBn(cat.nameBn || cat.name);
    setEditSlug(cat.slug);
    setEditDescription(cat.description || '');
    setEditImage(cat.image || '');
  };

  // Handle Save Edit
  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCategory || !editName.trim() || isUpdating) return;

    setIsUpdating(true);
    try {
      updateCategory(editingCategory.id, {
        name: editName.trim(),
        nameBn: (editNameBn || editName).trim(),
        slug: editSlug.trim() || editingCategory.slug,
        description: editDescription.trim(),
        image: editImage.trim() || editingCategory.image,
      });
      setEditingCategory(null);
    } finally {
      setIsUpdating(false);
    }
  };

  // Handle Confirm Delete
  const handleConfirmDelete = async () => {
    if (!categoryToDelete) return;
    await deleteCategory(categoryToDelete.id);
    setCategoryToDelete(null);
  };

  const linkedProductCount = categoryToDelete 
    ? products.filter(p => p.categorySlug === categoryToDelete.slug || p.category === categoryToDelete.name).length 
    : 0;

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-6 rounded-2xl border border-stone-200 dark:border-slate-700 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-teal-900 text-white rounded-xl shadow-xs">
            <Folders className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-serif font-bold text-stone-900 dark:text-white">
              {isBn ? 'ক্যাটাগরি ও মেনু ব্যবস্থাপনা' : 'Category & Menu Management'}
            </h1>
            <p className="text-xs text-stone-500 dark:text-slate-400 mt-0.5">
              {isBn 
                ? 'স্টোরফ্রন্ট ট্যাক্সোনমি, বাংলা অনুবাদ, ব্যানার এবং নেভিগেশন পরিচালনা করুন।' 
                : 'Manage storefront taxonomies, Bengali translations, banner visuals, and navigation tiles.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-3 py-1 bg-stone-100 dark:bg-slate-700 text-stone-700 dark:text-slate-200 rounded-xl text-xs font-bold border border-stone-200 dark:border-slate-600 flex items-center gap-1.5">
            <Tag className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
            <span>{categories.length} {isBn ? 'টি ক্যাটাগরি' : 'Taxonomies'}</span>
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Add Category Form */}
        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-stone-200 dark:border-slate-700 shadow-xs h-fit">
          <h2 className="text-sm font-bold text-stone-900 dark:text-white uppercase tracking-wider mb-4 flex items-center gap-2">
            <Plus className="w-4 h-4 text-teal-900 dark:text-teal-400" />
            {isBn ? 'নতুন ক্যাটাগরি যোগ করুন' : 'Add New Category'}
          </h2>

          <form onSubmit={handleAddCategory} className="space-y-3.5 text-xs">
            <div>
              <label className="font-bold text-stone-700 dark:text-slate-300 block mb-1">
                {isBn ? 'নাম (ইংরেজি) *' : 'Name (English) *'}
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Pure Honey & Organic"
                className="w-full p-2.5 bg-stone-50 dark:bg-slate-900 border border-stone-300 dark:border-slate-700 rounded-xl text-stone-900 dark:text-white focus:bg-white dark:focus:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-900/20 dark:focus:ring-teal-500/20 transition-all"
              />
            </div>

            <div>
              <label className="font-bold text-stone-700 dark:text-slate-300 block mb-1">
                {isBn ? 'নাম (বাংলা) *' : 'Name (Bangla) *'}
              </label>
              <input
                type="text"
                required
                value={nameBn}
                onChange={(e) => setNameBn(e.target.value)}
                placeholder="e.g. খাঁটি সুন্দরবনের মধু"
                className="w-full p-2.5 bg-stone-50 dark:bg-slate-900 border border-stone-300 dark:border-slate-700 rounded-xl text-stone-900 dark:text-white focus:bg-white dark:focus:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-900/20 dark:focus:ring-teal-500/20 font-bangla transition-all"
              />
            </div>

            <div>
              <label className="font-bold text-stone-700 dark:text-slate-300 block mb-1">
                {isBn ? 'বিবরণ' : 'Description'}
              </label>
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={isBn ? 'ক্যাটাগরি ব্যানারের সংক্ষিপ্ত বিবরণ...' : 'Short tagline for category header...'}
                className="w-full p-2.5 bg-stone-50 dark:bg-slate-900 border border-stone-300 dark:border-slate-700 rounded-xl text-stone-900 dark:text-white focus:bg-white dark:focus:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-900/20 dark:focus:ring-teal-500/20 transition-all"
              />
            </div>

            <div>
              <label className="font-bold text-stone-700 dark:text-slate-300 block mb-1">
                {isBn ? 'ব্যানার ছবি URL' : 'Banner Image URL'}
              </label>
              <input
                type="url"
                value={image}
                aria-label="image"
                onChange={(e) => setImage(e.target.value)}
                placeholder="https://images.unsplash.com/..."
                className="w-full p-2.5 bg-stone-50 dark:bg-slate-900 border border-stone-300 dark:border-slate-700 rounded-xl text-stone-900 dark:text-white focus:bg-white dark:focus:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-900/20 dark:focus:ring-teal-500/20 transition-all"
              />
              {image && (
                <div className="mt-2 relative rounded-lg overflow-hidden border border-stone-200 dark:border-slate-700 h-24 bg-stone-100 dark:bg-slate-900">
                  <img src={image} alt="Preview" className="w-full h-full object-cover" onError={(e) => (e.currentTarget.style.display = 'none')} />
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={saving}
              className="w-full py-2.5 bg-teal-900 hover:bg-teal-950 text-white rounded-xl font-bold shadow-xs transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              <span>{saving ? (isBn ? 'সংরক্ষণ হচ্ছে...' : 'Saving...') : (isBn ? 'ক্যাটাগরি সংরক্ষণ করুন' : 'Save Category')}</span>
            </button>
          </form>
        </div>

        {/* Existing Categories List */}
        <div className="lg:col-span-2 space-y-3">
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-stone-200 dark:border-slate-700 shadow-xs overflow-hidden">
            <div className="p-4 border-b border-stone-200 dark:border-slate-700 bg-stone-50/50 dark:bg-slate-800/80 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
              <span className="text-xs font-bold text-stone-700 dark:text-slate-200 uppercase tracking-wider">
                {isBn ? `সক্রিয় ক্যাটাগরি (${categories.length})` : `Active Taxonomies (${categories.length})`}
              </span>

              {/* Search filter */}
              <div className="relative w-full sm:w-64">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
                <input
                  type="text"
                  placeholder={isBn ? 'ক্যাটাগরি খুঁজুন...' : 'Search categories...'}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-7 py-1.5 bg-white dark:bg-slate-900 border border-stone-300 dark:border-slate-700 rounded-lg text-xs text-stone-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-teal-900"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 dark:hover:text-stone-200"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {filteredCategories.length === 0 ? (
              <div className="p-8 text-center text-stone-500 dark:text-slate-400 text-xs">
                {isBn ? 'কোনো ক্যাটাগরি পাওয়া যায়নি।' : 'No categories found matching your query.'}
              </div>
            ) : (
              <div className="divide-y divide-stone-200 dark:divide-slate-700">
                {filteredCategories.map((cat) => {
                  const count = products.filter(p => p.categorySlug === cat.slug || p.category === cat.name).length;
                  return (
                    <div 
                      key={cat.id} 
                      className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 hover:bg-stone-50 dark:hover:bg-slate-700/40 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <img 
                          src={cat.image} 
                          alt={cat.name} 
                          className="w-12 h-12 rounded-xl object-cover border border-stone-200 dark:border-slate-700 shrink-0 shadow-2xs" 
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h4 className="text-xs font-bold text-stone-900 dark:text-white truncate">{cat.name}</h4>
                            <span className="text-[10px] text-stone-400 dark:text-slate-400 font-mono bg-stone-100 dark:bg-slate-900 px-1.5 py-0.5 rounded border border-stone-200 dark:border-slate-700">
                              /{cat.slug}
                            </span>
                          </div>
                          <span className="text-[11px] text-stone-500 dark:text-slate-400 font-bangla block mt-0.5">
                            {cat.nameBn || cat.name}
                          </span>
                          {cat.description && (
                            <p className="text-[10px] text-stone-400 dark:text-slate-500 truncate max-w-sm mt-0.5">
                              {cat.description}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
                        <span className="px-2.5 py-1 bg-stone-100 dark:bg-slate-700/70 border border-stone-200 dark:border-slate-600 rounded-full text-xs font-semibold text-stone-700 dark:text-slate-300 flex items-center gap-1.5">
                          <Package className="w-3 h-3 text-stone-500 dark:text-slate-400" />
                          <span>{count} {isBn ? 'টি পণ্য' : 'items'}</span>
                        </span>
                        
                        {/* Edit Category Button */}
                        <button
                          onClick={() => handleOpenEdit(cat)}
                          className="p-2 text-stone-500 hover:text-teal-700 dark:text-slate-400 dark:hover:text-teal-400 hover:bg-stone-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                          title={isBn ? 'ক্যাটাগরি সম্পাদনা করুন' : 'Edit Category'}
                          aria-label={`Edit category ${cat.name}`}
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>

                        {/* Delete Category Button */}
                        <button
                          onClick={() => setCategoryToDelete(cat)}
                          className="p-2 text-stone-400 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg transition-colors"
                          title={isBn ? 'ক্যাটাগরি মুছে ফেলুন' : 'Delete Category'}
                          aria-label={`Delete category ${cat.name}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Edit Category Modal */}
      <AdminModalShell
        open={!!editingCategory}
        onClose={() => setEditingCategory(null)}
        label="Edit Category Modal"
        overlayClassName="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
      >
        {editingCategory && (
          <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl border border-stone-200 dark:border-slate-700 animate-in fade-in zoom-in duration-150">
            <div className="flex justify-between items-start pb-3 border-b border-stone-200 dark:border-slate-700">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-teal-50 dark:bg-teal-950/50 rounded-xl text-teal-800 dark:text-teal-300">
                  <Edit2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-serif font-bold text-stone-900 dark:text-white">
                    {isBn ? `ক্যাটাগরি সম্পাদনা: ${editingCategory.name}` : `Edit Category: ${editingCategory.name}`}
                  </h3>
                  <p className="text-[11px] text-stone-500 dark:text-slate-400">
                    {isBn ? 'শিরোনাম, বাংলা অনুবাদ, স্লাগ ও ব্যানার ছবি পরিবর্তন করুন।' : 'Update category name, Bengali translation, slug, and image.'}
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setEditingCategory(null)} 
                className="text-stone-400 hover:text-stone-900 dark:hover:text-white p-1"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-4 text-xs">
            <div>
              <label className="font-bold text-stone-700 dark:text-slate-300 block mb-1">
                {isBn ? 'নাম (ইংরেজি) *' : 'Name (English) *'}
              </label>
              <input
                type="text"
                required
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full p-2.5 bg-stone-50 dark:bg-slate-900 border border-stone-300 dark:border-slate-700 rounded-xl text-stone-900 dark:text-white focus:bg-white dark:focus:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-900/20 dark:focus:ring-teal-500/20"
              />
            </div>

            <div>
              <label className="font-bold text-stone-700 dark:text-slate-300 block mb-1">
                {isBn ? 'নাম (বাংলা) *' : 'Name (Bangla) *'}
              </label>
              <input
                type="text"
                required
                value={editNameBn}
                onChange={(e) => setEditNameBn(e.target.value)}
                className="w-full p-2.5 bg-stone-50 dark:bg-slate-900 border border-stone-300 dark:border-slate-700 rounded-xl text-stone-900 dark:text-white focus:bg-white dark:focus:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-900/20 dark:focus:ring-teal-500/20 font-bangla"
              />
            </div>

            <div>
              <label className="font-bold text-stone-700 dark:text-slate-300 block mb-1">
                {isBn ? 'ইউআরএল স্লাগ *' : 'URL Slug *'}
              </label>
              <input
                type="text"
                required
                value={editSlug}
                onChange={(e) => setEditSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, ''))}
                className="w-full p-2.5 bg-stone-50 dark:bg-slate-900 border border-stone-300 dark:border-slate-700 rounded-xl text-stone-900 dark:text-white font-mono focus:bg-white dark:focus:bg-slate-900 focus:outline-none"
              />
            </div>

            <div>
              <label className="font-bold text-stone-700 dark:text-slate-300 block mb-1">
                {isBn ? 'বিবরণ' : 'Description'}
              </label>
              <textarea
                rows={2}
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                className="w-full p-2.5 bg-stone-50 dark:bg-slate-900 border border-stone-300 dark:border-slate-700 rounded-xl text-stone-900 dark:text-white focus:bg-white dark:focus:bg-slate-900 focus:outline-none"
              />
            </div>

            <div>
              <label className="font-bold text-stone-700 dark:text-slate-300 block mb-1">
                {isBn ? 'ব্যানার ছবি URL' : 'Banner Image URL'}
              </label>
              <input
                type="url"
                value={editImage}
                onChange={(e) => setEditImage(e.target.value)}
                className="w-full p-2.5 bg-stone-50 dark:bg-slate-900 border border-stone-300 dark:border-slate-700 rounded-xl text-stone-900 dark:text-white focus:bg-white dark:focus:bg-slate-900 focus:outline-none"
              />
              {editImage && (
                <div className="mt-2 rounded-lg overflow-hidden border border-stone-200 dark:border-slate-700 h-28 bg-stone-100 dark:bg-slate-900">
                  <img src={editImage} alt="Category preview" className="w-full h-full object-cover" />
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-3 border-t border-stone-200 dark:border-slate-700">
              <button
                type="button"
                onClick={() => setEditingCategory(null)}
                className="px-4 py-2 border border-stone-300 dark:border-slate-600 rounded-xl font-bold text-stone-700 dark:text-slate-300 hover:bg-stone-100 dark:hover:bg-slate-700 transition-colors"
              >
                {isBn ? 'বাতিল' : 'Cancel'}
              </button>
              <button
                type="submit"
                disabled={isUpdating}
                className="px-5 py-2 bg-teal-900 hover:bg-teal-950 dark:bg-teal-700 dark:hover:bg-teal-600 text-white rounded-xl font-bold shadow-xs transition-colors disabled:opacity-50"
              >
                {isUpdating ? (isBn ? 'আপডেট হচ্ছে...' : 'Saving...') : (isBn ? 'আপডেট সংরক্ষণ করুন' : 'Update Category')}
              </button>
            </div>
          </form>
          </div>
        )}
      </AdminModalShell>

      {/* Delete Category Safety Confirmation Dialog */}
      <AdminConfirmDialog
        isOpen={!!categoryToDelete}
        onClose={() => setCategoryToDelete(null)}
        onConfirm={handleConfirmDelete}
        variant="danger"
        language={language}
        title={`Delete Category "${categoryToDelete?.name}"?`}
        titleBn={`"${categoryToDelete?.nameBn || categoryToDelete?.name}" ক্যাটাগরি অপসারণ করবেন?`}
        description={`Are you sure you want to permanently delete this taxonomy? ${
          linkedProductCount > 0
            ? `Warning: There are currently ${linkedProductCount} products linked to this category.`
            : 'No products are currently linked to this category.'
        }`}
        descriptionBn={`আপনি কি নিশ্চিত যে এই ক্যাটাগরিটি মুছে ফেলতে চান? ${
          linkedProductCount > 0
            ? `সতর্কতা: বর্তমানে এই ক্যাটাগরির অধীনে ${linkedProductCount}টি পণ্য রয়েছে।`
            : 'বর্তমানে এই ক্যাটাগরির অধীনে কোনো পণ্য নেই।'
        }`}
        confirmLabel="Delete Category"
        confirmLabelBn="ক্যাটাগরি মুছুন"
        items={
          categoryToDelete
            ? [
                {
                  id: categoryToDelete.id,
                  label: `${categoryToDelete.name} (${categoryToDelete.nameBn || ''})`,
                  subtext: `Slug: /${categoryToDelete.slug} · ${linkedProductCount} active products`,
                  imageUrl: categoryToDelete.image,
                },
              ]
            : []
        }
        requiresTypedConfirmation={linkedProductCount > 5}
        confirmationKeyword="DELETE"
      />
    </div>
  );
}
