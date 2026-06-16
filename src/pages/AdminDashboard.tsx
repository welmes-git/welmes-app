import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import type { Order, SetOption } from '../store/useStore';
import { useCurrency } from '../context/CurrencyContext';
import { initialProducts, brands, categories } from '../data/products';
import {
  LayoutDashboard,
  Users,
  Package,
  ClipboardList,
  ChevronLeft,
  ChevronRight,
  Search,
  Eye,
  Check,
  X,
  Pencil,
  Trash2,
  Plus,
  Bell,
  LogOut,
  TrendingUp,
  TrendingDown,
  X as XIcon,
} from 'lucide-react';

type AdminTab = 'dashboard' | 'members' | 'products' | 'orders';
type MemberStatus = 'all' | 'pending' | 'approved' | 'rejected';

const menuItems: { id: AdminTab; label: string; icon: React.ElementType }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'members', label: 'Members', icon: Users },
  { id: 'products', label: 'Products', icon: Package },
  { id: 'orders', label: 'Orders', icon: ClipboardList },
];

export default function AdminDashboard() {
  const navigate = useNavigate();
  const {
    isAuthenticated,
    isAdmin,
    currentUser,
    members,
    products,
    orders,
    approveMember,
    rejectMember,
    addProduct,
    updateProduct,
    deleteProduct,
    updateOrderStatus,
    loadMembers,
    loadOrders,
    logout,
    showToast,
  } = useStore();

  useEffect(() => {
    loadMembers();
    loadOrders();
  }, []);

  const { formatPrice } = useCurrency();
  const [activeTab, setActiveTab] = useState<AdminTab>('dashboard');
  const [memberFilter, setMemberFilter] = useState<MemberStatus>('all');
  const [memberSearch, setMemberSearch] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [showProductModal, setShowProductModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<number | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Discount rates per set option (UI-only state, not stored in SetOption)

  // Product form
  const [productForm, setProductForm] = useState({
    name: '',
    brand: brands[0],
    category: categories[1],
    originalPrice: 0,
    wholesalePrice: 0,
    stock: 0,
    description: '',
    tags: '',
    status: 'active' as 'active' | 'inactive',
    setOptions: [] as SetOption[],
    image: '',
  });

  const autoGenerateSets = () => {
    const u = productForm.wholesalePrice;
    const o = productForm.originalPrice;
    if (!u || !o) { showToast('Enter unit prices first', 'error'); return; }
    setProductForm((f) => ({
      ...f,
      setOptions: [
        { id: 'S1', description: 'Single Unit',      unitsPerSet: 1,  wholesalePrice: u,      originalPrice: o },
        { id: 'S2', description: 'Box of 12 Units',  unitsPerSet: 12, wholesalePrice: u * 12, originalPrice: o * 12 },
        { id: 'S3', description: 'Case of 24 Units', unitsPerSet: 24, wholesalePrice: u * 24, originalPrice: o * 24 },
      ],
    }));
  };

  const updateSetUnits = (idx: number, units: number) => {
    const u = productForm.wholesalePrice;
    const o = productForm.originalPrice;
    setProductForm((f) => ({
      ...f,
      setOptions: f.setOptions.map((s, i) =>
        i === idx ? { ...s, unitsPerSet: units, wholesalePrice: u * units, originalPrice: o * units } : s
      ),
    }));
  };

  const updateSetField = (idx: number, field: 'id' | 'description', value: string) => {
    setProductForm((f) => ({
      ...f,
      setOptions: f.setOptions.map((s, i) => (i === idx ? { ...s, [field]: value } : s)),
    }));
  };

  const addSetOption = () => {
    const nextId = `S${productForm.setOptions.length + 1}`;
    const u = productForm.wholesalePrice;
    const o = productForm.originalPrice;
    setProductForm((f) => ({
      ...f,
      setOptions: [
        ...f.setOptions,
        { id: nextId, description: '', unitsPerSet: 1, wholesalePrice: u, originalPrice: o },
      ],
    }));
  };

  const removeSetOption = (idx: number) => {
    setProductForm((f) => ({
      ...f,
      setOptions: f.setOptions.filter((_, i) => i !== idx),
    }));
  };

  useEffect(() => {
    if (!isAuthenticated || !isAdmin) {
      navigate('/login');
    }
  }, [isAuthenticated, isAdmin, navigate]);

  if (!isAuthenticated || !isAdmin) {
    return null;
  }

  const allProducts = products.length > 0 ? products : initialProducts;

  // Stats
  const totalMembers = members.length;
  const pendingMembers = members.filter((m) => m.status === 'pending').length;
  const totalProducts = allProducts.length;
  const todayOrders = orders.length;

  // Filtered members
  const filteredMembers = members.filter((m) => {
    if (memberFilter !== 'all' && m.status !== memberFilter) return false;
    if (memberSearch) {
      const q = memberSearch.toLowerCase();
      return (
        m.companyName.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q) ||
        m.businessNumber.includes(q)
      );
    }
    return true;
  });

  // Filtered products
  const filteredProducts = allProducts.filter((p) => {
    if (productSearch) {
      const q = productSearch.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) || p.brand.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const handleAddProduct = () => {
    setEditingProduct(null);
    setProductForm({
      name: '',
      brand: brands[0],
      category: categories[1],
      originalPrice: 0,
      wholesalePrice: 0,
      stock: 0,
      description: '',
      tags: '',
      status: 'active',
      setOptions: [],
      image: '',
    });
    setShowProductModal(true);
  };

  const handleEditProduct = (product: (typeof allProducts)[0]) => {
    setEditingProduct(product.id);
    const opts = product.setOptions ? [...product.setOptions] : [];
    const u = product.wholesalePrice;
    setProductForm({
      name: product.name,
      brand: product.brand,
      category: product.category,
      originalPrice: product.originalPrice,
      wholesalePrice: product.wholesalePrice,
      stock: product.stock,
      description: product.description,
      tags: product.tags.join(', '),
      status: product.status,
      setOptions: opts,
      image: product.image || '',
    });
    setShowProductModal(true);
  };

  const handleSaveProduct = async () => {
    if (!productForm.name) {
      showToast('Product name is required', 'error');
      return;
    }

    const discount = productForm.originalPrice > 0
      ? Math.round(
          ((productForm.originalPrice - productForm.wholesalePrice) /
            productForm.originalPrice) * 100
        )
      : 0;

    const productData = {
      name: productForm.name,
      brand: productForm.brand,
      category: productForm.category,
      image: productForm.image || '',
      originalPrice: productForm.originalPrice,
      wholesalePrice: productForm.wholesalePrice,
      discount,
      tags: productForm.tags.split(',').map((t) => t.trim()).filter(Boolean),
      rating: 0,
      reviews: 0,
      description: productForm.description,
      stock: productForm.stock,
      status: productForm.status,
      setOptions: productForm.setOptions.length > 0 ? productForm.setOptions : undefined,
    };

    if (editingProduct) {
      await updateProduct(editingProduct, productData);
      showToast('Product updated', 'success');
    } else {
      await addProduct(productData);
      showToast('Product added', 'success');
    }
    setShowProductModal(false);
  };

  const handleDeleteProduct = (id: number) => {
    if (confirm('Are you sure you want to delete this product?')) {
      deleteProduct(id);
      showToast('Product deleted', 'success');
    }
  };



  const statusColors = {
    pending: 'bg-yellow-100 text-yellow-700',
    approved: 'bg-green-100 text-green-700',
    rejected: 'bg-red-100 text-red-700',
  };

  const orderStatusColors = {
    pending: 'bg-yellow-100 text-yellow-700',
    processing: 'bg-blue-100 text-blue-700',
    shipped: 'bg-purple-100 text-purple-700',
    completed: 'bg-green-100 text-green-700',
    cancelled: 'bg-red-100 text-red-700',
  };

  return (
    <div className="min-h-screen bg-[#f4f5f7] flex">
      {/* Sidebar */}
      <aside
        className={`bg-[#2c3e50] text-white transition-all duration-300 ${
          sidebarOpen ? 'w-[240px]' : 'w-[60px]'
        } fixed h-full z-30`}
      >
        <div className="p-4 flex items-center justify-between">
          {sidebarOpen && (
            <Link to="/" className="text-[18px] font-bold">
              WELMES Admin
            </Link>
          )}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="w-8 h-8 flex items-center justify-center hover:bg-white/10 rounded"
          >
            {sidebarOpen ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
          </button>
        </div>

        <nav className="mt-4">
          {menuItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 text-[14px] transition-colors ${
                  activeTab === item.id
                    ? 'bg-white/10 border-l-[3px] border-[#4a90e2]'
                    : 'hover:bg-white/5 border-l-[3px] border-transparent'
                }`}
              >
                <Icon size={18} />
                {sidebarOpen && <span>{item.label}</span>}
              </button>
            );
          })}
        </nav>

        <div className="absolute bottom-0 left-0 right-0 p-4">
          <button
            onClick={() => {
              logout();
              navigate('/');
            }}
            className="flex items-center gap-3 text-[13px] text-white/70 hover:text-white"
          >
            <LogOut size={16} />
            {sidebarOpen && <span>Logout</span>}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main
        className={`flex-1 transition-all duration-300 ${
          sidebarOpen ? 'ml-[240px]' : 'ml-[60px]'
        }`}
      >
        {/* Top Bar */}
        <header className="bg-white border-b border-[#e5e5e5] px-6 py-3 flex items-center justify-between sticky top-0 z-20">
          <h1 className="text-[18px] font-bold text-[#333]">
            {menuItems.find((m) => m.id === activeTab)?.label}
          </h1>
          <div className="flex items-center gap-4">
            <button className="relative text-[#666] hover:text-[#333]">
              <Bell size={20} />
              {pendingMembers > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-[#ff4d6d] text-white text-[10px] rounded-full flex items-center justify-center">
                  {pendingMembers}
                </span>
              )}
            </button>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-[#4a90e2] rounded-full flex items-center justify-center text-white text-[12px] font-bold">
                {currentUser?.representative?.[0] || 'A'}
              </div>
              {sidebarOpen && (
                <span className="text-[13px] text-[#666]">
                  {currentUser?.companyName || 'Admin'}
                </span>
              )}
            </div>
          </div>
        </header>

        <div className="p-6">
          {/* Dashboard */}
          {activeTab === 'dashboard' && (
            <div>
              {/* Stats Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                {[
                  {
                    label: 'Total Members',
                    value: totalMembers,
                    trend: '+2',
                    up: true,
                    color: 'bg-blue-50 text-blue-600',
                  },
                  {
                    label: 'Pending Verifications',
                    value: pendingMembers,
                    trend: 'New',
                    up: true,
                    color: 'bg-yellow-50 text-yellow-600',
                  },
                  {
                    label: 'Total Products',
                    value: totalProducts,
                    trend: '+5',
                    up: true,
                    color: 'bg-green-50 text-green-600',
                  },
                  {
                    label: 'Total Orders',
                    value: todayOrders,
                    trend: '+12%',
                    up: true,
                    color: 'bg-purple-50 text-purple-600',
                  },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className="bg-white rounded-lg shadow-sm p-5"
                  >
                    <p className="text-[12px] text-[#999] mb-1">{stat.label}</p>
                    <div className="flex items-end justify-between">
                      <span className="text-[28px] font-bold text-[#333]">
                        {stat.value}
                      </span>
                      <span
                        className={`flex items-center gap-0.5 text-[12px] font-medium px-2 py-0.5 rounded ${stat.color}`}
                      >
                        {stat.up ? (
                          <TrendingUp size={12} />
                        ) : (
                          <TrendingDown size={12} />
                        )}
                        {stat.trend}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Recent Activity */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Recent Members */}
                <div className="bg-white rounded-lg shadow-sm p-5">
                  <h3 className="text-[16px] font-bold text-[#333] mb-4">
                    Recent Members
                  </h3>
                  <div className="space-y-3">
                    {members.slice(0, 5).map((member) => (
                      <div
                        key={member.id}
                        className="flex items-center justify-between py-2 border-b border-[#f5f5f5] last:border-0"
                      >
                        <div>
                          <p className="text-[13px] font-medium text-[#333]">
                            {member.companyName}
                          </p>
                          <p className="text-[11px] text-[#999]">
                            {member.email}
                          </p>
                        </div>
                        <span
                          className={`text-[11px] px-2 py-0.5 rounded ${
                            statusColors[member.status]
                          }`}
                        >
                          {member.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Recent Orders */}
                <div className="bg-white rounded-lg shadow-sm p-5">
                  <h3 className="text-[16px] font-bold text-[#333] mb-4">
                    Recent Orders
                  </h3>
                  <div className="space-y-3">
                    {orders.slice(0, 5).map((order) => (
                      <div
                        key={order.id}
                        className="flex items-center justify-between py-2 border-b border-[#f5f5f5] last:border-0"
                      >
                        <div>
                          <p className="text-[13px] font-medium text-[#333]">
                            {order.id}
                          </p>
                          <p className="text-[11px] text-[#999]">
                            {order.memberName}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-[13px] font-medium">
                            {formatPrice(order.total)}
                          </p>
                          <span
                            className={`text-[11px] px-2 py-0.5 rounded ${
                              orderStatusColors[order.status]
                            }`}
                          >
                            {order.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Members */}
          {activeTab === 'members' && (
            <div>
              {/* Filters */}
              <div className="bg-white rounded-lg shadow-sm p-4 mb-4 flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <Search
                    size={16}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-[#999]"
                  />
                  <input
                    type="text"
                    value={memberSearch}
                    onChange={(e) => setMemberSearch(e.target.value)}
                    placeholder="Search members..."
                    className="w-full h-10 pl-9 pr-4 border border-[#e5e5e5] rounded-lg text-[13px] focus:outline-none focus:border-[#333]"
                  />
                </div>
                <div className="flex gap-1">
                  {(['all', 'pending', 'approved', 'rejected'] as const).map(
                    (status) => (
                      <button
                        key={status}
                        onClick={() => setMemberFilter(status)}
                        className={`px-3 py-2 rounded-lg text-[12px] font-medium capitalize ${
                          memberFilter === status
                            ? 'bg-[#333] text-white'
                            : 'bg-[#f5f5f5] text-[#666] hover:bg-[#eee]'
                        }`}
                      >
                        {status}
                      </button>
                    )
                  )}
                </div>
              </div>

              {/* Members Table */}
              <div className="bg-white rounded-lg shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead className="bg-[#f8f8fa] text-[#666]">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium">ID</th>
                        <th className="px-4 py-3 text-left font-medium">
                          Company
                        </th>
                        <th className="px-4 py-3 text-left font-medium hidden md:table-cell">
                          Business No.
                        </th>
                        <th className="px-4 py-3 text-left font-medium hidden lg:table-cell">
                          Rep.
                        </th>
                        <th className="px-4 py-3 text-left font-medium">
                          Status
                        </th>
                        <th className="px-4 py-3 text-left font-medium hidden md:table-cell">
                          Date
                        </th>
                        <th className="px-4 py-3 text-left font-medium">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredMembers.map((member) => (
                        <tr
                          key={member.id}
                          className="border-t border-[#f5f5f5] hover:bg-[#fafafa]"
                        >
                          <td className="px-4 py-3 text-[#999]">
                            #{member.id}
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-[#333]">
                              {member.companyName}
                            </p>
                            <p className="text-[11px] text-[#999]">
                              {member.email}
                            </p>
                          </td>
                          <td className="px-4 py-3 text-[#666] hidden md:table-cell">
                            {member.businessNumber}
                          </td>
                          <td className="px-4 py-3 text-[#666] hidden lg:table-cell">
                            {member.representative}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`text-[11px] px-2 py-0.5 rounded ${
                                statusColors[member.status]
                              }`}
                            >
                              {member.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-[#999] hidden md:table-cell">
                            {member.registeredDate}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex gap-1">
                              {member.status === 'pending' && (
                                <>
                                  <button
                                    onClick={() => {
                                      approveMember(member.id);
                                      showToast(
                                        `${member.companyName} approved`,
                                        'success'
                                      );
                                    }}
                                    className="w-7 h-7 flex items-center justify-center bg-green-50 text-green-600 rounded hover:bg-green-100"
                                    title="Approve"
                                  >
                                    <Check size={14} />
                                  </button>
                                  <button
                                    onClick={() => {
                                      rejectMember(member.id);
                                      showToast(
                                        `${member.companyName} rejected`,
                                        'info'
                                      );
                                    }}
                                    className="w-7 h-7 flex items-center justify-center bg-red-50 text-red-600 rounded hover:bg-red-100"
                                    title="Reject"
                                  >
                                    <X size={14} />
                                  </button>
                                </>
                              )}
                              <button
                                className="w-7 h-7 flex items-center justify-center bg-[#f5f5f5] text-[#666] rounded hover:bg-[#eee]"
                                title="View"
                                onClick={() =>
                                  showToast(
                                    `View: ${member.companyName}`,
                                    'info'
                                  )
                                }
                              >
                                <Eye size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {filteredMembers.length === 0 && (
                  <div className="text-center py-8 text-[#999] text-[13px]">
                    No members found
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Products */}
          {activeTab === 'products' && (
            <div>
              {/* Header */}
              <div className="flex flex-col sm:flex-row gap-3 mb-4">
                <div className="relative flex-1">
                  <Search
                    size={16}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-[#999]"
                  />
                  <input
                    type="text"
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    placeholder="Search products..."
                    className="w-full h-10 pl-9 pr-4 border border-[#e5e5e5] rounded-lg text-[13px] focus:outline-none focus:border-[#333]"
                  />
                </div>
                <button
                  onClick={handleAddProduct}
                  className="h-10 px-4 bg-[#4a90e2] text-white rounded-lg text-[13px] font-medium flex items-center gap-2 hover:bg-[#357abd]"
                >
                  <Plus size={16} />
                  Add Product
                </button>
              </div>

              {/* Products Table */}
              <div className="bg-white rounded-lg shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead className="bg-[#f8f8fa] text-[#666]">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium">
                          Image
                        </th>
                        <th className="px-4 py-3 text-left font-medium">
                          Name
                        </th>
                        <th className="px-4 py-3 text-left font-medium hidden md:table-cell">
                          Brand
                        </th>
                        <th className="px-4 py-3 text-left font-medium">
                          Price
                        </th>
                        <th className="px-4 py-3 text-left font-medium hidden md:table-cell">
                          Stock
                        </th>
                        <th className="px-4 py-3 text-left font-medium">
                          Status
                        </th>
                        <th className="px-4 py-3 text-left font-medium">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredProducts.map((product) => (
                        <tr
                          key={product.id}
                          className="border-t border-[#f5f5f5] hover:bg-[#fafafa]"
                        >
                          <td className="px-4 py-3">
                            <img
                              src={product.image}
                              alt={product.name}
                              className="w-10 h-10 object-cover rounded"
                            />
                          </td>
                          <td className="px-4 py-3 max-w-[200px]">
                            <p className="font-medium text-[#333] truncate">
                              {product.name}
                            </p>
                          </td>
                          <td className="px-4 py-3 text-[#666] hidden md:table-cell">
                            {product.brand}
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-[#333]">
                              {formatPrice(product.wholesalePrice)}원
                            </p>
                            {product.discount > 0 && (
                              <p className="text-[11px] text-[#999]">
                                <span className="line-through">
                                  {formatPrice(product.originalPrice)}원
                                </span>{' '}
                                <span className="text-[#ff4d6d]">
                                  -{product.discount}%
                                </span>
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-[#666] hidden md:table-cell">
                            {product.stock}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`text-[11px] px-2 py-0.5 rounded ${
                                product.status === 'active'
                                  ? 'bg-green-100 text-green-700'
                                  : 'bg-red-100 text-red-700'
                              }`}
                            >
                              {product.status}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex gap-1">
                              <button
                                onClick={() => handleEditProduct(product)}
                                className="w-7 h-7 flex items-center justify-center bg-blue-50 text-blue-600 rounded hover:bg-blue-100"
                                title="Edit"
                              >
                                <Pencil size={14} />
                              </button>
                              <button
                                onClick={() =>
                                  handleDeleteProduct(product.id)
                                }
                                className="w-7 h-7 flex items-center justify-center bg-red-50 text-red-600 rounded hover:bg-red-100"
                                title="Delete"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Product Modal */}
              {showProductModal && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
                  <div className="bg-white rounded-lg w-full max-w-[720px] max-h-[90vh] overflow-y-auto">
                    <div className="flex items-center justify-between p-5 border-b border-[#e5e5e5]">
                      <h3 className="text-[16px] font-bold">
                        {editingProduct ? 'Edit Product' : 'Add Product'}
                      </h3>
                      <button
                        onClick={() => setShowProductModal(false)}
                        className="w-8 h-8 flex items-center justify-center hover:bg-[#f5f5f5] rounded"
                      >
                        <XIcon size={18} />
                      </button>
                    </div>
                    <div className="p-5 space-y-4">
                      <div>
                        <label className="block text-[12px] text-[#666] mb-1">
                          Product Name *
                        </label>
                        <input
                          type="text"
                          value={productForm.name}
                          onChange={(e) =>
                            setProductForm({
                              ...productForm,
                              name: e.target.value,
                            })
                          }
                          className="w-full h-10 px-3 border border-[#e5e5e5] rounded text-[13px] focus:outline-none focus:border-[#333]"
                        />
                      </div>

                      {/* Image URL */}
                      <div>
                        <label className="block text-[12px] text-[#666] mb-1">
                          Product Image URL
                        </label>
                        <div className="flex gap-2 items-start">
                          <input
                            type="text"
                            value={productForm.image}
                            onChange={(e) =>
                              setProductForm({ ...productForm, image: e.target.value })
                            }
                            placeholder="https://example.com/image.jpg"
                            className="flex-1 h-10 px-3 border border-[#e5e5e5] rounded text-[13px] focus:outline-none focus:border-[#333]"
                          />
                          {productForm.image && (
                            <div className="w-10 h-10 rounded border border-[#e5e5e5] overflow-hidden shrink-0 bg-[#f8f8fa]">
                              <img
                                src={productForm.image}
                                alt="preview"
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = 'none';
                                }}
                              />
                            </div>
                          )}
                        </div>
                        <p className="text-[11px] text-[#aaa] mt-1">
                          Paste a direct image URL. Leave blank to use the default placeholder.
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[12px] text-[#666] mb-1">
                            Brand *
                          </label>
                          <select
                            value={productForm.brand}
                            onChange={(e) =>
                              setProductForm({
                                ...productForm,
                                brand: e.target.value,
                              })
                            }
                            className="w-full h-10 px-3 border border-[#e5e5e5] rounded text-[13px] focus:outline-none focus:border-[#333]"
                          >
                            {brands.map((b) => (
                              <option key={b} value={b}>
                                {b}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[12px] text-[#666] mb-1">
                            Category *
                          </label>
                          <select
                            value={productForm.category}
                            onChange={(e) =>
                              setProductForm({
                                ...productForm,
                                category: e.target.value,
                              })
                            }
                            className="w-full h-10 px-3 border border-[#e5e5e5] rounded text-[13px] focus:outline-none focus:border-[#333]"
                          >
                            {categories
                              .filter((c) => c !== 'All')
                              .map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                          </select>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[12px] text-[#666] mb-1">
                            Original Price
                          </label>
                          <input
                            type="number"
                            value={productForm.originalPrice}
                            onChange={(e) =>
                              setProductForm({
                                ...productForm,
                                originalPrice: Number(e.target.value),
                              })
                            }
                            className="w-full h-10 px-3 border border-[#e5e5e5] rounded text-[13px] focus:outline-none focus:border-[#333]"
                          />
                        </div>
                        <div>
                          <label className="block text-[12px] text-[#666] mb-1">
                            Wholesale Price *
                          </label>
                          <input
                            type="number"
                            value={productForm.wholesalePrice}
                            onChange={(e) =>
                              setProductForm({
                                ...productForm,
                                wholesalePrice: Number(e.target.value),
                              })
                            }
                            className="w-full h-10 px-3 border border-[#e5e5e5] rounded text-[13px] focus:outline-none focus:border-[#333]"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[12px] text-[#666] mb-1">
                            Stock
                          </label>
                          <input
                            type="number"
                            value={productForm.stock}
                            onChange={(e) =>
                              setProductForm({
                                ...productForm,
                                stock: Number(e.target.value),
                              })
                            }
                            className="w-full h-10 px-3 border border-[#e5e5e5] rounded text-[13px] focus:outline-none focus:border-[#333]"
                          />
                        </div>
                        <div>
                          <label className="block text-[12px] text-[#666] mb-1">
                            Status
                          </label>
                          <select
                            value={productForm.status}
                            onChange={(e) =>
                              setProductForm({
                                ...productForm,
                                status: e.target.value as 'active' | 'inactive',
                              })
                            }
                            className="w-full h-10 px-3 border border-[#e5e5e5] rounded text-[13px] focus:outline-none focus:border-[#333]"
                          >
                            <option value="active">Active</option>
                            <option value="inactive">Inactive</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="block text-[12px] text-[#666] mb-1">
                          Tags (comma separated)
                        </label>
                        <input
                          type="text"
                          value={productForm.tags}
                          onChange={(e) =>
                            setProductForm({
                              ...productForm,
                              tags: e.target.value,
                            })
                          }
                          placeholder="Sale, Best, New"
                          className="w-full h-10 px-3 border border-[#e5e5e5] rounded text-[13px] focus:outline-none focus:border-[#333]"
                        />
                      </div>
                      <div>
                        <label className="block text-[12px] text-[#666] mb-1">
                          Description
                        </label>
                        <textarea
                          value={productForm.description}
                          onChange={(e) =>
                            setProductForm({
                              ...productForm,
                              description: e.target.value,
                            })
                          }
                          rows={3}
                          className="w-full px-3 py-2 border border-[#e5e5e5] rounded text-[13px] focus:outline-none focus:border-[#333] resize-none"
                        />
                      </div>

                      {/* ── Set Options ── */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <label className="text-[12px] font-semibold text-[#666]">
                            Set Options
                          </label>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={autoGenerateSets}
                              className="text-[11px] px-2.5 py-1 bg-[#f0f7ff] text-[#4a90e2] border border-[#4a90e2]/30 rounded hover:bg-[#4a90e2]/10 transition-colors"
                            >
                              ⚡ Auto-generate S1/S2/S3
                            </button>
                            <button
                              type="button"
                              onClick={addSetOption}
                              className="text-[11px] px-2.5 py-1 bg-[#f5f5f5] text-[#555] border border-[#ddd] rounded hover:bg-[#eee] transition-colors flex items-center gap-1"
                            >
                              <Plus size={11} />
                              Add Set
                            </button>
                          </div>
                        </div>

                        {productForm.setOptions.length === 0 ? (
                          <div className="text-center py-6 bg-[#f8f8fa] rounded-lg border border-dashed border-[#ddd] text-[12px] text-[#aaa]">
                            No sets configured. Use Auto-generate or Add Set to get started.
                          </div>
                        ) : (
                          <div className="border border-[#e5e5e5] rounded-lg overflow-hidden">
                            {/* Table header */}
                            <div className="grid grid-cols-[40px_1fr_80px_120px_32px] gap-1 bg-[#f8f8fa] px-2 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide border-b border-[#e5e5e5]">
                              <span>ID</span>
                              <span>Description</span>
                              <span className="text-center">Units/Set</span>
                              <span className="text-right">Set Total (auto)</span>
                              <span />
                            </div>
                            {/* Rows */}
                            {productForm.setOptions.map((opt, idx) => (
                              <div
                                key={idx}
                                className="grid grid-cols-[40px_1fr_80px_120px_32px] gap-1 items-center px-2 py-2 border-b border-[#f0f0f0] last:border-0 hover:bg-[#fafafa]"
                              >
                                <input
                                  value={opt.id}
                                  onChange={(e) => updateSetField(idx, 'id', e.target.value)}
                                  className="w-full h-7 px-1.5 border border-[#e5e5e5] rounded text-[12px] font-bold text-center focus:outline-none focus:border-[#4a90e2]"
                                  maxLength={3}
                                />
                                <input
                                  value={opt.description}
                                  onChange={(e) => updateSetField(idx, 'description', e.target.value)}
                                  placeholder="e.g. Box of 12"
                                  className="w-full h-7 px-2 border border-[#e5e5e5] rounded text-[12px] focus:outline-none focus:border-[#4a90e2]"
                                />
                                {/* Units per set */}
                                <input
                                  type="number"
                                  value={opt.unitsPerSet}
                                  onChange={(e) => updateSetUnits(idx, Number(e.target.value))}
                                  min={1}
                                  className="w-full h-7 px-1.5 border border-[#e5e5e5] rounded text-[12px] text-center focus:outline-none focus:border-[#4a90e2]"
                                />
                                {/* Set total (read-only, auto-calculated) */}
                                <div className="text-right pr-1">
                                  <p className="text-[13px] font-bold text-[#4a90e2]">
                                    ¥{(productForm.wholesalePrice * opt.unitsPerSet).toLocaleString()}
                                  </p>
                                  <p className="text-[10px] text-[#aaa]">
                                    ¥{productForm.wholesalePrice.toLocaleString()} × {opt.unitsPerSet}
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => removeSetOption(idx)}
                                  className="w-7 h-7 flex items-center justify-center text-[#ccc] hover:text-[#ff4d6d] hover:bg-red-50 rounded transition-colors"
                                >
                                  <XIcon size={13} />
                                </button>
                              </div>
                            ))}

                            {/* Summary row */}
                            <div className="px-3 py-2 bg-[#f8f8fa] border-t border-[#e5e5e5] text-[11px] text-[#999]">
                              {productForm.setOptions.length} set{productForm.setOptions.length !== 1 ? 's' : ''} configured
                              {productForm.wholesalePrice > 0 && ` · Unit price: ¥${productForm.wholesalePrice.toLocaleString()}`}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-3 p-5 border-t border-[#e5e5e5]">
                      <button
                        onClick={() => setShowProductModal(false)}
                        className="flex-1 h-10 border border-[#ddd] rounded-lg text-[13px] text-[#666] hover:bg-[#f5f5f5]"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSaveProduct}
                        className="flex-1 h-10 bg-[#4a90e2] text-white rounded-lg text-[13px] font-medium hover:bg-[#357abd]"
                      >
                        {editingProduct ? 'Update' : 'Add'} Product
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Orders */}
          {activeTab === 'orders' && (
            <div>
              <div className="bg-white rounded-lg shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead className="bg-[#f8f8fa] text-[#666]">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium">
                          Order ID
                        </th>
                        <th className="px-4 py-3 text-left font-medium">
                          Member
                        </th>
                        <th className="px-4 py-3 text-left font-medium">
                          Total
                        </th>
                        <th className="px-4 py-3 text-left font-medium">
                          Status
                        </th>
                        <th className="px-4 py-3 text-left font-medium hidden md:table-cell">
                          Date
                        </th>
                        <th className="px-4 py-3 text-left font-medium">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map((order) => (
                        <tr
                          key={order.id}
                          className="border-t border-[#f5f5f5] hover:bg-[#fafafa]"
                        >
                          <td className="px-4 py-3 font-medium text-[#333]">
                            {order.id}
                          </td>
                          <td className="px-4 py-3 text-[#666]">
                            {order.memberName}
                          </td>
                          <td className="px-4 py-3 font-medium text-[#333]">
                            {formatPrice(order.total)}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`text-[11px] px-2 py-0.5 rounded ${
                                orderStatusColors[order.status]
                              }`}
                            >
                              {order.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-[#999] hidden md:table-cell">
                            {order.date}
                          </td>
                          <td className="px-4 py-3">
                            <select
                              value={order.status}
                              onChange={(e) =>
                                updateOrderStatus(
                                  order.id,
                                  e.target.value as Order['status']
                                )
                              }
                              className="text-[12px] border border-[#ddd] rounded px-2 py-1 focus:outline-none"
                            >
                              <option value="pending">Pending</option>
                              <option value="processing">Processing</option>
                              <option value="shipped">Shipped</option>
                              <option value="completed">Completed</option>
                              <option value="cancelled">Cancelled</option>
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
