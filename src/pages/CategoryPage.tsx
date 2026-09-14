import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { ProductGrid } from '../components/ProductGrid';
import { useApp } from '../context/AppContext';
import { ProductImage } from '../components/ProductImage';
import { useSeo, breadcrumbStructuredData } from '../lib/seo';
import { ArrowLeft } from 'lucide-react';

export function CategoryPage() {
  const { slug } = useParams<{ slug: string }>();
  const { categories, language } = useApp();

  const category = categories.find((c) => c.slug === slug);
  const isBn = language === 'BN';

  // Runs before the not-found branch: hooks may not sit behind an early return.
  useSeo(
    {
      title: category ? `${category.name} | Kisholoy` : 'Category not found | Kisholoy',
      titleBn: category
        ? `${category.nameBn || category.name} | কিশলয়`
        : 'ক্যাটাগরি পাওয়া যায়নি | কিশলয়',
      description:
        category?.description ||
        'Browse the Kisholoy collection — in-house and artisan products sourced across Bangladesh, with nationwide delivery.',
      descriptionBn:
        category?.descriptionBn ||
        'কিশলয়ের ক্যাটালগ থেকে নিজস্ব ও যাচাইকৃত কারিগরের পণ্য কিনুন—সদেশে ডেলিভারিসহ।',
      path: `/category/${slug ?? ''}`,
      image: category?.image,
      imageAlt: category ? (isBn ? category.nameBn : category.name) : undefined,
      locale: isBn ? 'bn' : 'en',
      /** Unknown or hidden slugs should not be crawlable dead ends. */
      private: !category || (category.status !== undefined && category.status !== 'ACTIVE'),
      structuredData: category
        ? breadcrumbStructuredData([
            { name: 'Home', url: '/' },
            { name: 'Shop', url: '/shop' },
            { name: category.name, url: `/category/${category.slug}` },
          ])
        : undefined,
    },
    [slug, category?.id, language]
  );

  if (!category && slug !== 'all') {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 text-center">
        <h2 className="text-2xl font-bold font-serif mb-4 text-stone-900 dark:text-slate-100">Category Not Found</h2>
        <Link to="/shop" className="text-teal-800 dark:text-teal-300 font-semibold hover:underline">
          Return to Shop
        </Link>
      </div>
    );
  }

  const name = category ? (language === 'BN' ? category.nameBn : category.name) : 'All Products';
  const desc = category?.description || 'Browse all authentic handcrafted products.';

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
      <Link to="/shop" className="inline-flex items-center gap-1.5 text-xs font-semibold text-stone-500 hover:text-stone-900 mb-6">
        <ArrowLeft className="w-4 h-4" />
        {language === 'BN' ? 'সকল ক্যাটাগরিতে ফিরে যান' : 'Back to All Products'}
      </Link>

      <div className="relative rounded-2xl overflow-hidden bg-stone-900 text-white p-8 sm:p-12 mb-10 border border-stone-800 dark:border-slate-700">
        {category?.image && (
          <ProductImage
            src={category.image}
            alt={name}
            fill
            imgClassName="object-cover object-center opacity-30"
          />
        )}
        <div className="relative z-10 max-w-2xl">
          <span className="text-xs font-bold text-teal-300 uppercase tracking-widest block mb-2">
            {language === 'BN' ? 'ক্যাটাগরি সংগ্রহ' : 'Category Collection'}
          </span>
          <h1 className="text-3xl sm:text-4xl font-serif font-bold mb-3">{name}</h1>
          <p className="text-stone-300 text-sm sm:text-base leading-relaxed">{desc}</p>
        </div>
      </div>

      <ProductGrid categorySlug={slug} />
    </div>
  );
}
